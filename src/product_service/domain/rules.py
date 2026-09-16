"""Validation and domain rules for the Product / Service master.

Pure predicates and a :func:`validate_product` function returning a list of
human-readable, user-facing error messages. No value is mutated here. Rules
follow product/service rules, section 22:

  - Name and Item Type are required.
  - Unit of Measurement is required for a physical PRODUCT.
  - Money (prices) cannot be negative.
  - Percentage discount must be within ``[0, 100]``; a rupee discount cannot be
    negative.
  - CESS %, CESS amount and Low Stock Alert cannot be negative (all optional).
  - Tax rate cannot be negative.

HSN/SAC is left optional here: the application's existing invoice rules allow a
line's HSN/SAC to be blank, so it is not blindly enforced at the master level
(product/service rules, section 22).
"""

from __future__ import annotations

from decimal import Decimal

from product_service.domain.models import DiscountType, ItemType, Product

_HUNDRED = Decimal("100")


def normalize_name(name: str) -> str:
    """Return a normalized key for duplicate matching (case/space-insensitive)."""
    import re

    return re.sub(r"\s+", " ", name.strip()).lower()


def validate_product(product: Product) -> list[str]:
    """Validate a product and return a list of blocking error messages."""
    errors: list[str] = []

    if not product.name.strip():
        errors.append("Name is required.")

    if product.item_type is ItemType.PRODUCT and not product.unit_of_measurement.strip():
        errors.append("Unit of Measurement is required for a Product.")

    _reject_negative(errors, "Tax rate", product.tax_rate)
    _reject_negative(errors, "CESS %", product.cess_percent)
    _reject_negative(errors, "CESS Amount", product.cess_amount)

    _reject_negative(errors, "Sell Price", product.sell_price)
    _reject_negative(errors, "Sell Price (Incl. Tax)", product.sell_price_incl_tax)
    _reject_negative(errors, "Purchase Price", product.purchase_price)
    _reject_negative(errors, "Purchase Price (Incl. Tax)", product.purchase_price_incl_tax)

    _validate_discount(
        errors, "Sale Discount", product.sale_discount_type, product.sale_discount_value
    )
    _validate_discount(
        errors,
        "Purchase Discount",
        product.purchase_discount_type,
        product.purchase_discount_value,
    )

    if product.opening_qty is not None and product.opening_qty < 0:
        errors.append("Opening Quantity cannot be negative.")
    if product.low_stock_alert is not None and product.low_stock_alert < 0:
        errors.append("Low Stock Alert cannot be negative.")

    return errors


def _reject_negative(errors: list[str], label: str, value: Decimal) -> None:
    if value < 0:
        errors.append(f"{label} cannot be negative.")


def _validate_discount(
    errors: list[str], label: str, discount_type: DiscountType, value: Decimal
) -> None:
    if value < 0:
        errors.append(f"{label} cannot be negative.")
        return
    if discount_type is DiscountType.PERCENTAGE and value > _HUNDRED:
        errors.append(f"{label} percentage must be between 0 and 100.")
