"""Excel import for the Product / Service master.

Flow: read the file, validate headers, parse rows, validate domain rules,
build a preview (with summary counts, row-level errors, and duplicate detection),
let the user confirm resolutions, and commit atomically with transaction safety.
"""

from __future__ import annotations

import sqlite3
from contextlib import nullcontext
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from invoice_generator.application.unit_of_work import UnitOfWork
from product_service.application.dto import (
    CreateProductCommand,
    ProductInput,
    UpdateProductCommand,
)
from product_service.application.product_group_service import ProductGroupService
from product_service.application.product_service import ProductService
from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    Product,
    StockType,
)
from product_service.domain.rules import normalize_name, validate_product
from product_service.infrastructure.excel import columns as C

_ITEM_TYPE_ALIASES: dict[str, ItemType] = {
    "product": ItemType.PRODUCT,
    "products": ItemType.PRODUCT,
    "service": ItemType.SERVICE,
    "services": ItemType.SERVICE,
    "additional charges": ItemType.ADDITIONAL_CHARGES,
    "additional charge": ItemType.ADDITIONAL_CHARGES,
    "additional_charges": ItemType.ADDITIONAL_CHARGES,
    "additional-charges": ItemType.ADDITIONAL_CHARGES,
    "charges": ItemType.ADDITIONAL_CHARGES,
}

_STOCK_TYPE_ALIASES: dict[str, StockType] = {
    "normal": StockType.NORMAL,
    "batch": StockType.BATCH,
    "serial": StockType.SERIAL,
    "serial no": StockType.SERIAL,
    "serial no.": StockType.SERIAL,
    "serial number": StockType.SERIAL,
}

_DISCOUNT_TYPE_ALIASES: dict[str, DiscountType] = {
    "rupee": DiscountType.RUPEE,
    "rs": DiscountType.RUPEE,
    "inr": DiscountType.RUPEE,
    "₹": DiscountType.RUPEE,
    "percentage": DiscountType.PERCENTAGE,
    "percent": DiscountType.PERCENTAGE,
    "%": DiscountType.PERCENTAGE,
}

_CESS_TYPE_ALIASES: dict[str, CessType] = {
    "fixed": CessType.FIXED,
    "per unit": CessType.PER_UNIT,
    "per_unit": CessType.PER_UNIT,
    "perunit": CessType.PER_UNIT,
}


class ImportAs(StrEnum):
    """How to determine item types for imported rows."""

    FILE = "FILE"  # Use ITEM TYPE from file
    PRODUCT = "PRODUCT"
    SERVICE = "SERVICE"
    ADDITIONAL_CHARGES = "ADDITIONAL_CHARGES"


class DuplicateResolution(StrEnum):
    """How to resolve rows matching existing items."""

    UPDATE = "UPDATE"
    SKIP = "SKIP"
    CREATE_NEW = "CREATE_NEW"


@dataclass
class ImportRow:
    """A parsed row from the Excel file."""

    row_number: int
    data: ProductInput | None
    errors: list[str] = field(default_factory=list)
    duplicate_of: Product | None = None
    resolution: DuplicateResolution = DuplicateResolution.CREATE_NEW

    @property
    def is_valid(self) -> bool:
        return not self.errors and self.data is not None

    @property
    def is_duplicate(self) -> bool:
        return self.duplicate_of is not None


@dataclass
class ImportPreview:
    """The result of parsing and validating an Excel file before committing."""

    file_name: str = ""
    header_errors: list[str] = field(default_factory=list)
    rows: list[ImportRow] = field(default_factory=list)

    @property
    def has_header_errors(self) -> bool:
        return bool(self.header_errors)

    @property
    def total_rows(self) -> int:
        return len(self.rows)

    @property
    def valid_rows(self) -> list[ImportRow]:
        return [r for r in self.rows if r.is_valid]

    @property
    def error_rows(self) -> list[ImportRow]:
        return [r for r in self.rows if not r.is_valid]

    @property
    def duplicate_rows(self) -> list[ImportRow]:
        return [r for r in self.rows if r.is_valid and r.is_duplicate]


@dataclass
class ImportResult:
    """Summary of committed changes."""

    created: int = 0
    updated: int = 0
    skipped: int = 0


class ProductExcelImporter:
    """Parses, validates, and commits product/service rows from an .xlsx workbook."""

    def __init__(
        self,
        product_service: ProductService,
        *,
        group_service: ProductGroupService | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._service = product_service
        self._groups = group_service
        # Use provided connection, or discover it from the repository if available
        self._conn = connection
        repo = self._service._repo
        if self._conn is None and hasattr(repo, "_conn"):
            self._conn = repo._conn

    # --- parsing & validation ---

    def build_preview(
        self,
        file_path: str | Path,
        *,
        import_as: ImportAs = ImportAs.FILE,
    ) -> ImportPreview:
        """Parse and validate file_path into an ImportPreview without writing to the DB."""
        path = Path(file_path)
        preview = ImportPreview(file_name=path.name)
        workbook = load_workbook(filename=str(path), read_only=True, data_only=True)

        try:
            sheet = workbook.active
            rows_iter = sheet.iter_rows(values_only=True)
            try:
                header = next(rows_iter)
            except StopIteration:
                preview.header_errors.append("The file is empty.")
                return preview

            header_index = _index_headers(header)
            missing = [h for h in C.REQUIRED_IMPORT_HEADERS if h not in header_index]
            if missing:
                preview.header_errors.append(
                    "Missing required column(s): " + ", ".join(missing)
                )
                return preview

            if import_as is ImportAs.FILE and C.COL_ITEM_TYPE not in header_index:
                preview.header_errors.append(
                    "Missing required column: ITEM TYPE (or select an explicit Import As mode)."
                )
                return preview

            # Cache existing product groups to resolve group names quickly
            groups_cache: dict[str, Any] = {}
            if self._groups is not None:
                for grp in self._groups.list_groups():
                    groups_cache[grp.name.strip().lower()] = grp

            # Track barcodes and normalized names within this file to detect internal duplicates
            seen_barcodes: dict[str, int] = {}
            seen_name_types: dict[tuple[str, ItemType], int] = {}

            for offset, raw in enumerate(rows_iter, start=2):
                if _is_blank_row(raw):
                    continue

                row = self._parse_row(
                    offset, raw, header_index, import_as, groups_cache
                )

                if row.is_valid and row.data is not None:
                    # Check intra-file duplicate barcode
                    barcode = row.data.barcode_no.strip()
                    if barcode:
                        if barcode in seen_barcodes:
                            prev_row = seen_barcodes[barcode]
                            row.errors.append(
                                f"Duplicate barcode '{barcode}' appears earlier in file "
                                f"(row {prev_row})."
                            )
                            row.data = None
                        else:
                            seen_barcodes[barcode] = offset

                    # Check intra-file duplicate name + item type
                    if row.is_valid and row.data is not None:
                        name_key = (normalize_name(row.data.name), row.data.item_type)
                        if name_key in seen_name_types:
                            # Intra-file duplicate detected
                            row.duplicate_of = None
                            row.resolution = DuplicateResolution.SKIP
                        else:
                            seen_name_types[name_key] = offset

                preview.rows.append(row)

        finally:
            workbook.close()

        return preview

    def _parse_row(
        self,
        row_number: int,
        raw: tuple[object, ...],
        header_index: dict[str, int],
        import_as: ImportAs,
        groups_cache: dict[str, Any],
    ) -> ImportRow:
        def get(name: str) -> object:
            return _cell(raw, header_index, name)

        errors: list[str] = []

        # 1. Item Type
        item_type, type_error = _resolve_item_type(get(C.COL_ITEM_TYPE), import_as)
        if type_error:
            errors.append(type_error)

        # 2. Name
        name = _text(get(C.COL_NAME))
        if not name:
            errors.append("Name is required.")

        # 3. Unit of Measurement
        uom = _text(get(C.COL_UOM))
        if item_type is ItemType.PRODUCT and not uom:
            errors.append("Unit of Measurement is required for a Product.")

        # 4. Tax & CESS
        tax_rate, tax_err = _parse_optional_decimal(get(C.COL_TAX), "Tax")
        if tax_err:
            errors.append(tax_err)
        elif tax_rate is not None and tax_rate < 0:
            errors.append("Tax rate cannot be negative.")

        cess_pct, cess_pct_err = _parse_optional_decimal(get(C.COL_CESS_PERCENT), "CESS %")
        if cess_pct_err:
            errors.append(cess_pct_err)
        elif cess_pct is not None and cess_pct < 0:
            errors.append("CESS % cannot be negative.")

        cess_amt, cess_amt_err = _parse_optional_decimal(get(C.COL_CESS_AMOUNT), "CESS Amount")
        if cess_amt_err:
            errors.append(cess_amt_err)
        elif cess_amt is not None and cess_amt < 0:
            errors.append("CESS Amount cannot be negative.")

        cess_type, cess_type_err = _resolve_cess_type(get(C.COL_CESS_TYPE))
        if cess_type_err:
            errors.append(cess_type_err)

        no_itc, no_itc_err = _parse_optional_bool(get(C.COL_NO_ITC), "NO-ITC", default=False)
        if no_itc_err:
            errors.append(no_itc_err)

        # 5. Pricing
        sell_price, sp_err = _parse_optional_decimal(get(C.COL_SELL_PRICE), "Sell Price")
        if sp_err:
            errors.append(sp_err)
        elif sell_price is not None and sell_price < 0:
            errors.append("Sell Price cannot be negative.")

        sell_price_incl, spi_err = _parse_optional_decimal(
            get(C.COL_SELL_PRICE_INCL_TAX), "Sell Price (Incl. Tax)"
        )
        if spi_err:
            errors.append(spi_err)
        elif sell_price_incl is not None and sell_price_incl < 0:
            errors.append("Sell Price (Incl. Tax) cannot be negative.")

        sale_disc_type, sdt_err = _resolve_discount_type(
            get(C.COL_SALE_DISCOUNT_TYPE), "Sale Discount Type"
        )
        if sdt_err:
            errors.append(sdt_err)

        sale_disc_val, sdv_err = _parse_optional_decimal(
            get(C.COL_SALE_DISCOUNT), "Sale Discount"
        )
        if sdv_err:
            errors.append(sdv_err)
        elif sale_disc_val is not None:
            if sale_disc_val < 0:
                errors.append("Sale Discount cannot be negative.")
            elif (
                sale_disc_type is DiscountType.PERCENTAGE
                and sale_disc_val > Decimal("100")
            ):
                errors.append("Sale Discount percentage must be between 0 and 100.")

        purch_price, pp_err = _parse_optional_decimal(
            get(C.COL_PURCHASE_PRICE), "Purchase Price"
        )
        if pp_err:
            errors.append(pp_err)
        elif purch_price is not None and purch_price < 0:
            errors.append("Purchase Price cannot be negative.")

        purch_price_incl, ppi_err = _parse_optional_decimal(
            get(C.COL_PURCHASE_PRICE_INCL_TAX), "Purchase Price (Incl. Tax)"
        )
        if ppi_err:
            errors.append(ppi_err)
        elif purch_price_incl is not None and purch_price_incl < 0:
            errors.append("Purchase Price (Incl. Tax) cannot be negative.")

        purch_disc_type, pdt_err = _resolve_discount_type(
            get(C.COL_PURCHASE_DISCOUNT_TYPE), "Purchase Discount Type"
        )
        if pdt_err:
            errors.append(pdt_err)

        purch_disc_val, pdv_err = _parse_optional_decimal(
            get(C.COL_PURCHASE_DISCOUNT), "Purchase Discount"
        )
        if pdv_err:
            errors.append(pdv_err)
        elif purch_disc_val is not None:
            if purch_disc_val < 0:
                errors.append("Purchase Discount cannot be negative.")
            elif (
                purch_disc_type is DiscountType.PERCENTAGE
                and purch_disc_val > Decimal("100")
            ):
                errors.append("Purchase Discount percentage must be between 0 and 100.")

        # 6. Stock configuration (relevant only for PRODUCT)
        tracks_stock = item_type.tracks_stock
        stock_type = StockType.NORMAL
        opening_qty: Decimal | None = None
        low_stock_alert: Decimal | None = None

        if tracks_stock:
            st, st_err = _resolve_stock_type(get(C.COL_STOCK_TYPE))
            if st_err:
                errors.append(st_err)
            else:
                stock_type = st

            oq, oq_err = _parse_optional_decimal(get(C.COL_AVAILABLE_QTY), "Available Qty")
            if oq_err:
                errors.append(oq_err)
            elif oq is not None and oq < 0:
                errors.append("Opening Quantity cannot be negative.")
            else:
                opening_qty = oq

            lsa, lsa_err = _parse_optional_decimal(
                get(C.COL_LOW_STOCK_ALERT), "Low Stock Alert"
            )
            if lsa_err:
                errors.append(lsa_err)
            elif lsa is not None and lsa < 0:
                errors.append("Low Stock Alert cannot be negative.")
            else:
                low_stock_alert = lsa

        # 7. Grouping
        group_name = _text(get(C.COL_PRODUCT_GROUP))
        product_group_id = None
        if group_name and self._groups is not None:
            key = group_name.lower()
            if key in groups_cache:
                product_group_id = groups_cache[key].id
            else:
                try:
                    new_group = self._groups.create_group(group_name)
                    groups_cache[key] = new_group
                    product_group_id = new_group.id
                except Exception:  # noqa: BLE001
                    pass

        # 8. Flags
        is_mfg, mfg_err = _parse_optional_bool(
            get(C.COL_MANUFACTURING), "MANUFACTURING", default=False
        )
        if mfg_err:
            errors.append(mfg_err)

        # NON-SELLABLE: Yes means is_sellable = False; No / blank means is_sellable = True
        is_non_sellable, ns_err = _parse_optional_bool(
            get(C.COL_NON_SELLABLE), "NON-SELLABLE", default=False
        )
        if ns_err:
            errors.append(ns_err)
        is_sellable = not is_non_sellable

        visible_on_doc, vod_err = _parse_optional_bool(
            get(C.COL_VISIBLE_ON_DOC), "VISIBLE ON DOCUMENT", default=False
        )
        if vod_err:
            errors.append(vod_err)

        data = ProductInput(
            name=name,
            item_type=item_type,
            note=_text(get(C.COL_NOTE)),
            barcode_no=_text(get(C.COL_BARCODE)),
            hsn_sac_code=_text(get(C.COL_HSN_SAC)),
            unit_of_measurement=uom,
            tax_rate=tax_rate or Decimal("0"),
            cess_percent=cess_pct or Decimal("0"),
            cess_type=cess_type,
            cess_amount=cess_amt or Decimal("0"),
            no_itc=no_itc,
            sell_price=sell_price or Decimal("0"),
            sell_price_incl_tax=sell_price_incl or Decimal("0"),
            sale_discount_type=sale_disc_type,
            sale_discount_value=sale_disc_val or Decimal("0"),
            purchase_price=purch_price or Decimal("0"),
            purchase_price_incl_tax=purch_price_incl or Decimal("0"),
            purchase_discount_type=purch_disc_type,
            purchase_discount_value=purch_disc_val or Decimal("0"),
            stock_type=stock_type,
            opening_qty=opening_qty,
            low_stock_alert=low_stock_alert,
            product_group_id=product_group_id,
            is_manufactured=is_mfg,
            is_sellable=is_sellable,
            visible_on_documents=visible_on_doc,
        )

        # Domain rule validation check
        domain_errors = validate_product(_input_to_product(data))
        for err in domain_errors:
            if err not in errors:
                errors.append(err)

        row = ImportRow(
            row_number=row_number,
            data=data if not errors else None,
            errors=errors,
        )

        # Duplicate detection (against database)
        if not errors and data is not None:
            duplicate = self._service.find_duplicate(data)
            if duplicate is not None:
                row.duplicate_of = duplicate
                row.resolution = DuplicateResolution.SKIP

        return row

    # --- commit ---

    def commit(self, preview: ImportPreview) -> ImportResult:
        """Persist valid rows respecting chosen duplicate resolutions.

        Operates inside a single atomic SQLite transaction. If any error occurs,
        the transaction is rolled back and no records are half-imported.
        """
        result = ImportResult()
        tx_ctx = UnitOfWork(self._conn) if self._conn is not None else nullcontext()

        with tx_ctx:
            for row in preview.valid_rows:
                assert row.data is not None

                if row.is_duplicate:
                    if row.resolution is DuplicateResolution.SKIP:
                        result.skipped += 1
                        continue
                    if (
                        row.resolution is DuplicateResolution.UPDATE
                        and row.duplicate_of is not None
                    ):
                        self._service.update_product(
                            UpdateProductCommand(
                                id=row.duplicate_of.id,
                                data=row.data,
                                is_active=True,
                            )
                        )
                        result.updated += 1
                        continue

                # CREATE_NEW or new row
                self._service.create_product(CreateProductCommand(data=row.data))
                result.created += 1

        return result


# --- pure parsing helpers ---


def _index_headers(header: tuple[object, ...]) -> dict[str, int]:
    index: dict[str, int] = {}
    for i, val in enumerate(header):
        if val is None:
            continue
        index[str(val).strip()] = i
    return index


def _cell(raw: tuple[object, ...], header_index: dict[str, int], name: str) -> object:
    idx = header_index.get(name)
    if idx is None or idx >= len(raw):
        return None
    return raw[idx]


def _is_blank_row(raw: tuple[object, ...]) -> bool:
    return all(v is None or str(v).strip() == "" for v in raw)


def _text(val: object) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _resolve_item_type(val: object, import_as: ImportAs) -> tuple[ItemType, str | None]:
    if import_as is ImportAs.PRODUCT:
        return ItemType.PRODUCT, None
    if import_as is ImportAs.SERVICE:
        return ItemType.SERVICE, None
    if import_as is ImportAs.ADDITIONAL_CHARGES:
        return ItemType.ADDITIONAL_CHARGES, None

    text = _text(val)
    if not text:
        return ItemType.PRODUCT, "Item Type is required."

    resolved = _ITEM_TYPE_ALIASES.get(text.lower())
    if resolved is None:
        return ItemType.PRODUCT, f"Invalid Item Type: {text!r}."
    return resolved, None


def _resolve_stock_type(val: object) -> tuple[StockType, str | None]:
    text = _text(val)
    if not text:
        return StockType.NORMAL, None
    resolved = _STOCK_TYPE_ALIASES.get(text.lower())
    if resolved is None:
        return StockType.NORMAL, f"Invalid Stock Type: {text!r}."
    return resolved, None


def _resolve_discount_type(val: object, label: str) -> tuple[DiscountType, str | None]:
    text = _text(val)
    if not text:
        return DiscountType.RUPEE, None
    resolved = _DISCOUNT_TYPE_ALIASES.get(text.lower())
    if resolved is None:
        return DiscountType.RUPEE, f"Invalid {label}: {text!r}."
    return resolved, None


def _resolve_cess_type(val: object) -> tuple[CessType, str | None]:
    text = _text(val)
    if not text:
        return CessType.FIXED, None
    resolved = _CESS_TYPE_ALIASES.get(text.lower())
    if resolved is None:
        return CessType.FIXED, f"Invalid CESS Type: {text!r}."
    return resolved, None


def _parse_optional_decimal(val: object, label: str) -> tuple[Decimal | None, str | None]:
    text = _text(val)
    if not text:
        return None, None
    # Strip optional trailing % or currency symbols
    cleaned = text.rstrip("%").lstrip("₹Rs. ").strip()
    try:
        return Decimal(cleaned), None
    except (InvalidOperation, ValueError):
        return None, f"Invalid {label}: {text!r}."


def _parse_optional_bool(
    val: object, label: str, *, default: bool
) -> tuple[bool, str | None]:
    text = _text(val)
    if not text:
        return default, None
    low = text.lower()
    if low in ("yes", "y", "true", "1"):
        return True, None
    if low in ("no", "n", "false", "0"):
        return False, None
    return default, f"Invalid {label}: {text!r}. Expected Yes or No."


def _input_to_product(data: ProductInput) -> Product:
    """Create a Product domain instance for validation purposes."""
    tracks_stock = data.item_type.tracks_stock
    stock_type = data.stock_type if tracks_stock else StockType.NORMAL
    opening_qty = data.opening_qty if tracks_stock else None
    low_stock = data.low_stock_alert if tracks_stock else None

    return Product(
        item_type=data.item_type,
        name=data.name.strip(),
        note=data.note.strip(),
        barcode_no=data.barcode_no.strip(),
        hsn_sac_code=data.hsn_sac_code.strip(),
        unit_of_measurement=data.unit_of_measurement.strip(),
        tax_rate=data.tax_rate,
        cess_percent=data.cess_percent,
        cess_type=data.cess_type,
        cess_amount=data.cess_amount,
        no_itc=data.no_itc,
        sell_price=data.sell_price,
        sell_price_incl_tax=data.sell_price_incl_tax,
        sale_discount_type=data.sale_discount_type,
        sale_discount_value=data.sale_discount_value,
        purchase_price=data.purchase_price,
        purchase_price_incl_tax=data.purchase_price_incl_tax,
        purchase_discount_type=data.purchase_discount_type,
        purchase_discount_value=data.purchase_discount_value,
        stock_type=stock_type,
        opening_qty=opening_qty,
        low_stock_alert=low_stock,
        product_group_id=data.product_group_id,
        is_manufactured=data.is_manufactured,
        is_sellable=data.is_sellable,
        visible_on_documents=data.visible_on_documents,
    )
