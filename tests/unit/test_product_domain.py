"""Unit tests for the Product / Service master domain rules and models.

Pure, fast tests over :func:`validate_product` and the domain enums / model.
Money is asserted with exact ``Decimal`` values (never float tolerance).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    Product,
    StockType,
)
from product_service.domain.rules import normalize_name, validate_product

pytestmark = pytest.mark.unit


def _product(**overrides: object) -> Product:
    base: dict[str, object] = {"name": "Widget", "item_type": ItemType.PRODUCT,
                               "unit_of_measurement": "Nos"}
    base.update(overrides)
    return Product(**base)  # type: ignore[arg-type]


def test_item_type_labels_are_business_facing() -> None:
    assert ItemType.PRODUCT.label == "Product"
    assert ItemType.SERVICE.label == "Service"
    assert ItemType.ADDITIONAL_CHARGES.label == "Additional Charges"


def test_only_product_tracks_stock() -> None:
    assert ItemType.PRODUCT.tracks_stock is True
    assert ItemType.SERVICE.tracks_stock is False
    assert ItemType.ADDITIONAL_CHARGES.tracks_stock is False


def test_stock_type_labels() -> None:
    assert StockType.NORMAL.label == "Normal"
    assert StockType.BATCH.label == "Batch"
    assert StockType.SERIAL.label == "Serial No."


def test_valid_product_has_no_errors() -> None:
    assert validate_product(_product()) == []


def test_name_is_required() -> None:
    errors = validate_product(_product(name="  "))
    assert any("Name is required" in e for e in errors)


def test_unit_required_for_product_only() -> None:
    product_errors = validate_product(_product(unit_of_measurement=""))
    assert any("Unit of Measurement is required" in e for e in product_errors)

    service_ok = validate_product(
        Product(name="Machining", item_type=ItemType.SERVICE, unit_of_measurement="")
    )
    assert service_ok == []

    charge_ok = validate_product(
        Product(name="Freight", item_type=ItemType.ADDITIONAL_CHARGES, unit_of_measurement="")
    )
    assert charge_ok == []


def test_negative_money_rejected() -> None:
    errors = validate_product(_product(sell_price=Decimal("-1")))
    assert any("Sell Price cannot be negative" in e for e in errors)


def test_percentage_discount_bounds() -> None:
    errors = validate_product(
        _product(sale_discount_type=DiscountType.PERCENTAGE, sale_discount_value=Decimal("150"))
    )
    assert any("percentage must be between 0 and 100" in e for e in errors)


def test_rupee_discount_negative_rejected() -> None:
    errors = validate_product(
        _product(purchase_discount_type=DiscountType.RUPEE, purchase_discount_value=Decimal("-5"))
    )
    assert any("Purchase Discount cannot be negative" in e for e in errors)


def test_cess_and_low_stock_non_negative() -> None:
    errors = validate_product(
        _product(cess_amount=Decimal("-1"), low_stock_alert=Decimal("-2"))
    )
    assert any("CESS Amount cannot be negative" in e for e in errors)
    assert any("Low Stock Alert cannot be negative" in e for e in errors)


def test_blank_optional_fields_accepted() -> None:
    product = _product(
        note="", barcode_no="", hsn_sac_code="", cess_amount=Decimal("0"),
        opening_qty=None, low_stock_alert=None, product_group_id=None,
        image_asset_id=None,
    )
    assert validate_product(product) == []


def test_cess_type_default_is_fixed() -> None:
    assert _product().cess_type is CessType.FIXED


def test_normalize_name_is_case_and_space_insensitive() -> None:
    assert normalize_name("  Mould   Base  ") == "mould base"
    assert normalize_name("MOULD BASE") == normalize_name("mould base")
