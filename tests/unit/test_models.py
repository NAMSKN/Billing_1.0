"""Unit tests for domain models."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from invoice_generator.domain.enums import (
    InvoiceStatus,
    PaymentStatus,
    TaxTreatment,
)
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    TaxRateConfig,
)
from tests.support.id_factory import SequentialIdGenerator


def test_company_construction_and_defaults() -> None:
    company = Company(name="Suntech Enterprises")
    assert company.name == "Suntech Enterprises"
    assert isinstance(company.id, uuid.UUID)
    assert company.active is True
    assert isinstance(company.address, Address)


def test_customer_bill_to_and_ship_to_are_distinct_objects() -> None:
    bill = Address(line="12 Industrial Rd", state_name="Maharashtra", state_code="27")
    ship = Address(line="Plot 9 Godown", state_name="Maharashtra", state_code="27")
    customer = Customer(name="BMSS Steel", bill_to=bill, ship_to=ship)
    assert customer.bill_to == bill
    assert customer.ship_to == ship
    assert customer.bill_to is not customer.ship_to


def test_ship_to_preserved_as_distinct_even_when_equal() -> None:
    addr = Address(line="Same address", state_name="Maharashtra", state_code="27")
    customer = Customer(bill_to=addr, ship_to=addr)
    # Equal values but still two separate fields (design section 2).
    assert customer.bill_to == customer.ship_to
    assert "bill_to" in Customer.model_fields
    assert "ship_to" in Customer.model_fields


def test_entities_have_uuid_ids() -> None:
    assert isinstance(Company().id, uuid.UUID)
    assert isinstance(Customer().id, uuid.UUID)
    assert isinstance(InvoiceLine().id, uuid.UUID)
    assert isinstance(Invoice().id, uuid.UUID)


def test_ids_can_be_injected_from_generator() -> None:
    gen = SequentialIdGenerator(start=1)
    company = Company(id=gen(), name="X")
    invoice = Invoice(id=gen())
    assert str(company.id) == "00000000-0000-4000-8000-000000000001"
    assert str(invoice.id) == "00000000-0000-4000-8000-000000000002"


def test_models_are_frozen_immutable() -> None:
    company = Company(name="X")
    with pytest.raises(ValidationError):
        company.name = "Y"  # type: ignore[misc]


def test_invoice_finalized_values_are_immutable() -> None:
    invoice = Invoice(status=InvoiceStatus.FINALIZED, invoice_number="SE/26-27/043")
    with pytest.raises(ValidationError):
        invoice.invoice_number = "SE/26-27/099"  # type: ignore[misc]
    with pytest.raises(ValidationError):
        invoice.status = InvoiceStatus.CANCELLED  # type: ignore[misc]


def test_update_via_model_copy_preserves_id() -> None:
    invoice = Invoice(notes="draft note")
    original_id = invoice.id
    updated = invoice.model_copy(update={"notes": "edited note"})
    assert updated.notes == "edited note"
    assert updated.id == original_id  # id not regenerated on update
    assert invoice.notes == "draft note"  # original unchanged (immutable)


def test_invoice_uuid_distinct_from_invoice_number() -> None:
    invoice = Invoice()
    # Draft: has a UUID identity but no business number yet (D-025).
    assert isinstance(invoice.id, uuid.UUID)
    assert invoice.invoice_number is None
    finalized = invoice.model_copy(
        update={"status": InvoiceStatus.FINALIZED, "invoice_number": "SE/26-27/043"}
    )
    assert finalized.id == invoice.id
    assert finalized.invoice_number == "SE/26-27/043"
    assert str(finalized.id) != finalized.invoice_number


def test_invoice_lifecycle_and_payment_status_are_independent() -> None:
    invoice = Invoice(
        status=InvoiceStatus.FINALIZED,
        payment_status=PaymentStatus.UNPAID,
    )
    assert invoice.status is InvoiceStatus.FINALIZED
    assert invoice.payment_status is PaymentStatus.UNPAID


def test_invoice_line_uses_decimal_and_defaults_taxable_treatment() -> None:
    line = InvoiceLine(
        description="6 Side Machining 510x430x130",
        hsn_sac="998898",
        quantity=Decimal("16"),
        unit="NOS",
        rate=Decimal("767.50"),
        tax_rate=Decimal("18"),
    )
    assert isinstance(line.quantity, Decimal)
    assert isinstance(line.rate, Decimal)
    assert line.tax_treatment is TaxTreatment.TAXABLE
    assert line.taxable_amount is None  # not calculated yet


def test_tax_rate_config_holds_explicit_components() -> None:
    cfg = TaxRateConfig(
        total_rate=Decimal("18"),
        cgst_rate=Decimal("9"),
        sgst_rate=Decimal("9"),
        igst_rate=Decimal("18"),
    )
    assert cfg.cgst_rate + cfg.sgst_rate == cfg.total_rate
    assert cfg.igst_rate == cfg.total_rate


def test_extra_fields_forbidden() -> None:
    with pytest.raises(ValidationError):
        Company(unknown_field="x")  # type: ignore[call-arg]
