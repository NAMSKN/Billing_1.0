"""Excel export for the Product / Service master.

Exports products, services, or additional charges to a formatted .xlsx workbook.
Numeric values use exact Decimal cells.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Sequence
from decimal import Decimal
from enum import StrEnum
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from product_service.domain.models import ItemType, Product
from product_service.infrastructure.excel import columns as C


class ExportScope(StrEnum):
    """Which item types to export."""

    PRODUCTS = "PRODUCTS"
    SERVICES = "SERVICES"
    ADDITIONAL_CHARGES = "ADDITIONAL_CHARGES"
    ALL = "ALL"


def select_for_scope(products: Iterable[Product], scope: ExportScope) -> list[Product]:
    """Filter products according to the requested scope without duplicates."""
    seen_ids: set[uuid.UUID] = set()
    result: list[Product] = []

    for product in products:
        if product.id in seen_ids:
            continue
        if scope is ExportScope.PRODUCTS and product.item_type is not ItemType.PRODUCT:
            continue
        if scope is ExportScope.SERVICES and product.item_type is not ItemType.SERVICE:
            continue
        if (
            scope is ExportScope.ADDITIONAL_CHARGES
            and product.item_type is not ItemType.ADDITIONAL_CHARGES
        ):
            continue
        seen_ids.add(product.id)
        result.append(product)

    return result


class ProductExcelExporter:
    """Writes selected products/services to a business-facing .xlsx workbook."""

    def __init__(
        self,
        group_name_resolver: Callable[[uuid.UUID | None], str] | None = None,
    ) -> None:
        self._group_name = group_name_resolver or (lambda _gid: "")

    def export(
        self,
        products: Sequence[Product],
        scope: ExportScope,
        output_path: str | Path,
        *,
        overwrite: bool = False,
    ) -> Path:
        """Export products matching scope to output_path.

        Raises FileExistsError if output_path exists and overwrite is False.
        """
        path = Path(output_path)
        if path.exists() and not overwrite:
            raise FileExistsError(f"File already exists: {path}")

        selected = select_for_scope(products, scope)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Products & Services"

        # Headers
        sheet.append(list(C.EXPORT_COLUMNS))
        for cell in sheet[1]:
            cell.font = Font(bold=True)

        # Freeze header row
        sheet.freeze_panes = "A2"

        # Rows
        for product in selected:
            sheet.append(self._row_for(product))

        # Adjust column widths
        for col_idx, col in enumerate(sheet.columns, start=1):
            max_len = 0
            for cell in col:
                val = cell.value
                val_str = "" if val is None else str(val)
                if len(val_str) > max_len:
                    max_len = len(val_str)
            col_letter = get_column_letter(col_idx)
            sheet.column_dimensions[col_letter].width = max(max_len + 3, 12)

        path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(str(path))
        return path

    def _row_for(self, product: Product) -> list[object]:
        tracks_stock = product.tracks_stock
        stock_type = product.stock_type.label if tracks_stock else ""
        opening_qty = _decimal_cell(product.opening_qty) if tracks_stock else ""
        low_stock = _decimal_cell(product.low_stock_alert) if tracks_stock else ""

        return [
            product.item_type.label,
            product.name,
            product.note,
            product.barcode_no,
            product.hsn_sac_code,
            product.unit_of_measurement,
            _decimal_cell(product.tax_rate),
            _decimal_cell(product.cess_percent),
            product.cess_type.label,
            _decimal_cell(product.cess_amount),
            "Yes" if product.no_itc else "No",
            _decimal_cell(product.sell_price),
            _decimal_cell(product.sell_price_incl_tax),
            product.sale_discount_type.label,
            _decimal_cell(product.sale_discount_value),
            _decimal_cell(product.purchase_price),
            _decimal_cell(product.purchase_price_incl_tax),
            product.purchase_discount_type.label,
            _decimal_cell(product.purchase_discount_value),
            stock_type,
            opening_qty,
            low_stock,
            self._group_name(product.product_group_id),
            "Yes" if product.is_manufactured else "No",
            "Yes" if not product.is_sellable else "No",
            "Yes" if product.visible_on_documents else "No",
        ]


def _decimal_cell(value: Decimal | None) -> object:
    if value is None:
        return ""
    return value
