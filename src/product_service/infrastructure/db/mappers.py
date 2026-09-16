"""Row <-> domain-model mapping for the product master (persistence boundary).

Conversions between exact storage representations (UUID TEXT, INTEGER paise,
decimal-as-TEXT) and domain models (UUID, Decimal) happen here only. Money is
stored as integer paise; tax/CESS percentages, discount values, and optional
quantities are stored as exact decimal strings so they round-trip without
float. UUIDs are canonical lowercase TEXT (DECISIONS D-024).
"""

from __future__ import annotations

import sqlite3
import uuid
from decimal import Decimal

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.money import from_paise, to_paise
from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    Product,
    ProductGroup,
    StockType,
)


def _uid_opt(value: uuid.UUID | None) -> str | None:
    return None if value is None else to_canonical(value)


def _decimal_opt_to_text(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


def _text_to_decimal_opt(value: str | None) -> Decimal | None:
    return None if value is None or value == "" else Decimal(value)


def product_to_row(p: Product) -> dict[str, object]:
    """Serialize a :class:`Product` to a column dict for INSERT/REPLACE."""
    return {
        "id": to_canonical(p.id),
        "company_id": None,
        "item_type": p.item_type.value,
        "name": p.name,
        "note": p.note,
        "barcode_no": p.barcode_no,
        "hsn_sac_code": p.hsn_sac_code,
        "unit_of_measurement": p.unit_of_measurement,
        "tax_rate": str(p.tax_rate),
        "cess_percent": str(p.cess_percent),
        "cess_type": p.cess_type.value,
        "cess_amount_paise": to_paise(p.cess_amount),
        "no_itc": 1 if p.no_itc else 0,
        "sell_price_paise": to_paise(p.sell_price),
        "sell_price_incl_tax_paise": to_paise(p.sell_price_incl_tax),
        "sale_discount_type": p.sale_discount_type.value,
        "sale_discount_value": str(p.sale_discount_value),
        "purchase_price_paise": to_paise(p.purchase_price),
        "purchase_price_incl_tax_paise": to_paise(p.purchase_price_incl_tax),
        "purchase_discount_type": p.purchase_discount_type.value,
        "purchase_discount_value": str(p.purchase_discount_value),
        "stock_type": p.stock_type.value,
        "opening_qty": _decimal_opt_to_text(p.opening_qty),
        "low_stock_alert": _decimal_opt_to_text(p.low_stock_alert),
        "product_group_id": _uid_opt(p.product_group_id),
        "image_asset_id": _uid_opt(p.image_asset_id),
        "is_manufactured": 1 if p.is_manufactured else 0,
        "is_sellable": 1 if p.is_sellable else 0,
        "visible_on_documents": 1 if p.visible_on_documents else 0,
        "is_active": 1 if p.is_active else 0,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def row_to_product(row: sqlite3.Row) -> Product:
    """Rehydrate a :class:`Product` from a ``products`` row."""
    group_id = row["product_group_id"]
    image_id = row["image_asset_id"]
    return Product(
        id=uuid.UUID(row["id"]),
        item_type=ItemType(row["item_type"]),
        name=row["name"],
        note=row["note"],
        barcode_no=row["barcode_no"],
        hsn_sac_code=row["hsn_sac_code"],
        unit_of_measurement=row["unit_of_measurement"],
        tax_rate=Decimal(row["tax_rate"]),
        cess_percent=Decimal(row["cess_percent"]),
        cess_type=CessType(row["cess_type"]),
        cess_amount=from_paise(int(row["cess_amount_paise"])),
        no_itc=bool(row["no_itc"]),
        sell_price=from_paise(int(row["sell_price_paise"])),
        sell_price_incl_tax=from_paise(int(row["sell_price_incl_tax_paise"])),
        sale_discount_type=DiscountType(row["sale_discount_type"]),
        sale_discount_value=Decimal(row["sale_discount_value"]),
        purchase_price=from_paise(int(row["purchase_price_paise"])),
        purchase_price_incl_tax=from_paise(int(row["purchase_price_incl_tax_paise"])),
        purchase_discount_type=DiscountType(row["purchase_discount_type"]),
        purchase_discount_value=Decimal(row["purchase_discount_value"]),
        stock_type=StockType(row["stock_type"]),
        opening_qty=_text_to_decimal_opt(row["opening_qty"]),
        low_stock_alert=_text_to_decimal_opt(row["low_stock_alert"]),
        product_group_id=uuid.UUID(group_id) if group_id else None,
        image_asset_id=uuid.UUID(image_id) if image_id else None,
        is_manufactured=bool(row["is_manufactured"]),
        is_sellable=bool(row["is_sellable"]),
        visible_on_documents=bool(row["visible_on_documents"]),
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def group_to_row(g: ProductGroup) -> dict[str, object]:
    return {
        "id": to_canonical(g.id),
        "name": g.name,
        "is_active": 1 if g.is_active else 0,
    }


def row_to_group(row: sqlite3.Row) -> ProductGroup:
    return ProductGroup(
        id=uuid.UUID(row["id"]),
        name=row["name"],
        is_active=bool(row["is_active"]),
    )
