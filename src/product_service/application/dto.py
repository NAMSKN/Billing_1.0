"""Application DTOs / commands for the Product / Service master.

Frozen dataclasses that carry raw form input into the service. The service
trims, validates, and assembles the immutable :class:`Product` domain entity.
Both the exclusive-tax and inclusive-tax prices entered by the user are carried
through unchanged; the service never silently converts one into the other.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    StockType,
)


@dataclass(frozen=True)
class ProductInput:
    """Shared product field payload used for create and update."""

    name: str
    item_type: ItemType = ItemType.PRODUCT
    note: str = ""
    barcode_no: str = ""
    hsn_sac_code: str = ""
    unit_of_measurement: str = ""

    tax_rate: Decimal = Decimal("0")
    cess_percent: Decimal = Decimal("0")
    cess_type: CessType = CessType.FIXED
    cess_amount: Decimal = Decimal("0")
    no_itc: bool = False

    sell_price: Decimal = Decimal("0")
    sell_price_incl_tax: Decimal = Decimal("0")
    sale_discount_type: DiscountType = DiscountType.RUPEE
    sale_discount_value: Decimal = Decimal("0")
    purchase_price: Decimal = Decimal("0")
    purchase_price_incl_tax: Decimal = Decimal("0")
    purchase_discount_type: DiscountType = DiscountType.RUPEE
    purchase_discount_value: Decimal = Decimal("0")

    stock_type: StockType = StockType.NORMAL
    opening_qty: Decimal | None = None
    low_stock_alert: Decimal | None = None

    product_group_id: uuid.UUID | None = None
    image_asset_id: uuid.UUID | None = None

    is_manufactured: bool = False
    is_sellable: bool = True
    visible_on_documents: bool = False


@dataclass(frozen=True)
class CreateProductCommand:
    """Command to create a new product."""

    data: ProductInput


@dataclass(frozen=True)
class UpdateProductCommand:
    """Command to update an existing product (identified by ``id``)."""

    id: uuid.UUID
    data: ProductInput
    is_active: bool = True
