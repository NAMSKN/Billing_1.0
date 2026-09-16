"""Integration tests: Product master <-> invoice form (V2 Feature 2, items 30-32).

Verifies that selecting a product pre-fills an invoice line with the product's
defaults, that a later edit to the product master does NOT rewrite an
already-saved draft's line values, and that an archived product remains valid
for a historical invoice while disappearing from new selection.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.domain.models import Address, Company, Customer
from invoice_generator.ui.invoices.invoice_form_controller import InvoiceFormController
from product_service.application.dto import (
    CreateProductCommand,
    ProductInput,
    UpdateProductCommand,
)
from product_service.domain.models import DiscountType, ItemType
from tests.support.build_test_app import build_test_app

pytestmark = pytest.mark.integration


def _make_company(app) -> None:  # type: ignore[no-untyped-def]
    company = Company(
        name="Suntech Moulds",
        address=Address(line="HQ", state_name="Maharashtra", state_code="27"),
        gstin="27ABCDE1234F1Z5",
    )
    app.company_service_repo.save(company)
    app.connection.commit()


def _make_customer(app):  # type: ignore[no-untyped-def]
    customer = Customer(
        name="BMSS Steel",
        bill_to=Address(line="Cust Rd", state_name="Maharashtra", state_code="27"),
    )
    app.customer_service_repo.save(customer)
    app.connection.commit()
    return customer


def _make_product(app, **overrides):  # type: ignore[no-untyped-def]
    data = dict(
        name="Mould Base",
        item_type=ItemType.PRODUCT,
        unit_of_measurement="Nos",
        hsn_sac_code="8480",
        tax_rate=Decimal("18"),
        sell_price=Decimal("1000.00"),
    )
    data.update(overrides)
    product = app.product_service.create_product(
        CreateProductCommand(data=ProductInput(**data))
    )
    app.connection.commit()
    return product


def test_product_populates_invoice_line_defaults(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    _make_company(app)
    product = _make_product(
        app, sale_discount_type=DiscountType.PERCENTAGE, sale_discount_value=Decimal("10")
    )

    controller = InvoiceFormController(app)
    controller.new_draft()
    line = controller.insert_product(product.id)

    assert line.description == "Mould Base"
    assert line.hsn_sac == "8480"
    assert line.unit == "Nos"
    assert line.rate == Decimal("1000.00")
    assert line.tax_rate == Decimal("18")
    assert line.discount_percent == Decimal("10")
    assert line.quantity == Decimal(1)
    app.close()


def test_service_and_charges_selectable(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    _make_company(app)
    svc = _make_product(app, name="Machining", item_type=ItemType.SERVICE,
                        unit_of_measurement="", hsn_sac_code="9988")
    controller = InvoiceFormController(app)
    controller.new_draft()
    ids = {p.id for p in controller.available_sellable_products()}
    assert svc.id in ids
    line = controller.insert_product(svc.id)
    assert line.description == "Machining"
    app.close()


def test_nonsellable_absent_from_new_invoice(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    _make_company(app)
    nonsell = _make_product(app, name="Raw Steel", unit_of_measurement="Kg",
                           is_sellable=False)
    controller = InvoiceFormController(app)
    controller.new_draft()
    ids = {p.id for p in controller.available_sellable_products()}
    assert nonsell.id not in ids
    with pytest.raises(ValueError):
        controller.insert_product(nonsell.id)
    app.close()


def test_product_edit_does_not_rewrite_saved_draft(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    _make_company(app)
    product = _make_product(app, sell_price=Decimal("1000.00"))

    controller = InvoiceFormController(app)
    controller.new_draft()
    controller.insert_product(product.id)
    controller.save_draft()
    invoice_id = controller.working.id
    app.connection.commit()

    # Edit the product master AFTER the draft has captured the line values.
    app.product_service.update_product(UpdateProductCommand(
        id=product.id,
        data=ProductInput(
            name="Mould Base v2", item_type=ItemType.PRODUCT,
            unit_of_measurement="Nos", hsn_sac_code="8480", tax_rate=Decimal("28"),
            sell_price=Decimal("9999.00"),
        ),
        is_active=True,
    ))
    app.connection.commit()

    # Reopen the saved draft: its captured line values must be unchanged.
    reopened = InvoiceFormController(app)
    reopened.load_invoice(invoice_id)
    assert len(reopened.working.lines) == 1
    line = reopened.working.lines[0]
    assert line.description == "Mould Base"
    assert line.rate == Decimal("1000.00")
    assert line.tax_rate == Decimal("18")
    app.close()


def test_archived_product_remains_valid_for_history(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    _make_company(app)
    customer = _make_customer(app)
    product = _make_product(app)

    controller = InvoiceFormController(app)
    controller.new_draft()
    controller.select_customer(customer.id)
    controller.insert_product(product.id)
    controller.finalize(invoice_date=date(2026, 6, 1))
    invoice_id = controller.working.id
    app.connection.commit()

    # Archive the product; it must vanish from new selection...
    app.product_service.archive_product(product.id)
    app.connection.commit()
    fresh = InvoiceFormController(app)
    fresh.new_draft()
    assert product.id not in {p.id for p in fresh.available_sellable_products()}

    # ...but the finalized historical invoice remains accessible and intact.
    historical = app.invoice_service.get(invoice_id)
    assert historical is not None
    assert historical.invoice_number is not None
    assert len(historical.lines) == 1
    assert historical.lines[0].description == "Mould Base"
    app.close()
