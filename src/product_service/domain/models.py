"""Domain models for the Product / Service master (V2 Feature 2).

A single :class:`Product` record models one of three business-facing item
types: a physical ``PRODUCT`` (may carry stock), a non-stock ``SERVICE``, or an
``ADDITIONAL_CHARGES`` billing item (freight, packing, labour, etc.). Only a
``PRODUCT`` supports stock configuration (Normal / Batch / Serial); services
and additional charges never carry stock (product/service rules, sections 1,
6, 16).

Money (prices, discounts, CESS amount) uses ``Decimal`` in the domain and is
persisted as integer paise at the repository boundary; no float is ever used
for money (coding standards, DECISIONS D-004). Percentages (tax rate, CESS %,
percentage discount) are ``Decimal`` too.

The product stores *tax configuration/defaults* only. Actual invoice GST
calculation stays in the single calculation engine; this model never
recalculates tax (architecture rules; DECISIONS D-006).

These are frozen pydantic models: immutable and hashable. Conversion to/from
storage happens only in the repository layer. Ids are application-generated
UUID4 (DECISIONS D-023), distinct from any human-facing identifier.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum

from pydantic import Field

from common.domain.base import DomainModel


class ItemType(StrEnum):
    """Business-facing item type (product/service rules, section 1)."""

    PRODUCT = "PRODUCT"
    SERVICE = "SERVICE"
    ADDITIONAL_CHARGES = "ADDITIONAL_CHARGES"

    @property
    def label(self) -> str:
        """User-facing display label (shown exactly in the UI)."""
        return _ITEM_TYPE_LABELS[self]

    @property
    def tracks_stock(self) -> bool:
        """True only for a physical product; services/charges never track stock."""
        return self is ItemType.PRODUCT


_ITEM_TYPE_LABELS: dict[ItemType, str] = {
    ItemType.PRODUCT: "Product",
    ItemType.SERVICE: "Service",
    ItemType.ADDITIONAL_CHARGES: "Additional Charges",
}


class StockType(StrEnum):
    """Stock-tracking configuration for a physical product (section 6).

    This is *configuration only* for this feature: it establishes the master
    data required for a future inventory/stock-movement engine. No stock
    movement is implemented in this task.
    """

    NORMAL = "NORMAL"
    BATCH = "BATCH"
    SERIAL = "SERIAL"

    @property
    def label(self) -> str:
        return _STOCK_TYPE_LABELS[self]


_STOCK_TYPE_LABELS: dict[StockType, str] = {
    StockType.NORMAL: "Normal",
    StockType.BATCH: "Batch",
    StockType.SERIAL: "Serial No.",
}


class DiscountType(StrEnum):
    """Whether a discount value is an absolute rupee amount or a percentage."""

    RUPEE = "RUPEE"
    PERCENTAGE = "PERCENTAGE"

    @property
    def label(self) -> str:
        return "Rupee" if self is DiscountType.RUPEE else "Percentage"


class CessType(StrEnum):
    """CESS applicability: a fixed amount or a per-unit amount (section 3)."""

    FIXED = "FIXED"
    PER_UNIT = "PER_UNIT"

    @property
    def label(self) -> str:
        return "Fixed" if self is CessType.FIXED else "Per Unit"


class ProductGroup(DomainModel):
    """A selectable product group (product/service rules, section 9).

    Groups are created, renamed, and archived through the UI. A group that is
    referenced by any product is never hard-deleted; it is archived instead. A
    product belongs to at most one group (no multi-level hierarchy in V1).
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str = ""
    is_active: bool = True


class Product(DomainModel):
    """A product, service, or additional-charges master record.

    Immutable domain entity keyed by an application-generated UUID4. Optional
    fields default to empty/None/zero so blank values persist successfully
    (product/service rules: notes, barcode, CESS, low-stock alert, group and
    image are all optional).

    Pricing keeps both the exclusive-tax price and the inclusive-tax price the
    user entered; neither is silently converted/overwritten by the domain. The
    exclusive ``sell_price`` / ``purchase_price`` are the authoritative values
    used to pre-fill invoice/purchase lines (product/service rules, section 4);
    the inclusive fields are stored for display/reference only.

    Stock fields are meaningful only when :attr:`item_type` is ``PRODUCT``.
    ``opening_qty`` is an initial/opening quantity distinct from any future
    transactional stock ledger (product/service rules, section 7); no stock-in
    / stock-out is implemented here.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    item_type: ItemType = ItemType.PRODUCT

    # --- product detail ---
    name: str = ""
    note: str = ""
    barcode_no: str = ""
    hsn_sac_code: str = ""
    unit_of_measurement: str = ""

    # --- tax (defaults only; the engine calculates actual invoice tax) ---
    tax_rate: Decimal = Decimal("0")
    cess_percent: Decimal = Decimal("0")
    cess_type: CessType = CessType.FIXED
    cess_amount: Decimal = Decimal("0")
    no_itc: bool = False

    # --- pricing (Decimal money; both exclusive and inclusive kept) ---
    sell_price: Decimal = Decimal("0")
    sell_price_incl_tax: Decimal = Decimal("0")
    sale_discount_type: DiscountType = DiscountType.RUPEE
    sale_discount_value: Decimal = Decimal("0")
    purchase_price: Decimal = Decimal("0")
    purchase_price_incl_tax: Decimal = Decimal("0")
    purchase_discount_type: DiscountType = DiscountType.RUPEE
    purchase_discount_value: Decimal = Decimal("0")

    # --- stock configuration (PRODUCT only) ---
    stock_type: StockType = StockType.NORMAL
    opening_qty: Decimal | None = None
    low_stock_alert: Decimal | None = None

    # --- grouping / assets ---
    product_group_id: uuid.UUID | None = None
    image_asset_id: uuid.UUID | None = None

    # --- flags ---
    is_manufactured: bool = False
    is_sellable: bool = True
    visible_on_documents: bool = False

    is_active: bool = True
    created_at: str = ""
    updated_at: str = ""

    @property
    def tracks_stock(self) -> bool:
        """True when this item's type carries stock configuration."""
        return self.item_type.tracks_stock
