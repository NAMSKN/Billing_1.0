"""Unit tests for the strict finalization validation gate on InvoiceService."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

import pytest

from invoice_generator.application.invoice_service import (
    InvoiceService,
    InvoiceServiceError,
)
from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from tests.support.fakes import (
    InMemoryCompanyRepository,
    InMemoryCustomerRepository,
    InMemoryInvoiceRepository,
)

VALID_GSTIN = "27ABCDE1234F1Z5"
INVOICE_DATE = date(2026, 5, 11)


def _valid_line() -> InvoiceLine:
    return InvoiceLine(
        description="6 Side Machining",
        hsn_sac="998898",
        quantity=Decimal("16"),
        unit="NOS",
        rate=Decimal("767.50"),
        tax_rate=Decimal("18"),
    )


def _build(
    company: Company,
    customer: Customer,
    invoice: Invoice,
) -> tuple[InvoiceService, Invoice]:
    companies = InMemoryCompanyRepository()
    customers = InMemoryCustomerRepository()
    companies.save(company)
    customers.save(customer)
    invoice = invoice.model_copy(update={"customer_id": customer.id})
    conn = sqlite3.connect(":memory:")
    service = InvoiceService(
        conn,
        InMemoryInvoiceRepository(),
        company_repository=companies,
        customer_repository=customers,
    )
    return service, invoice


def _valid_setup() -> tuple[InvoiceService, Invoice]:
    company = Company(name="Suntech", gstin=VALID_GSTIN)
    customer = Customer(
        name="BMSS Steel",
        bill_to=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
    )
    invoice = Invoice(
        place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
        lines=(_valid_line(),),
    )
    return _build(company, customer, invoice)


def test_valid_invoice_passes_gate() -> None:
    service, invoice = _valid_setup()
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    assert result.is_ok is True
    assert result.blocking == ()


def test_missing_company_name_blocks() -> None:
    company = Company(name="")
    customer = Customer(
        name="Cust", bill_to=Address(line="x", state_code="27")
    )
    invoice = Invoice(place_of_supply=PlaceOfSupply(state_code="27"), lines=(_valid_line(),))
    service, invoice = _build(company, customer, invoice)
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    assert any(i.field == "company.name" for i in result.blocking)


def test_missing_bill_to_blocks() -> None:
    company = Company(name="Suntech")
    customer = Customer(name="Cust")  # no bill_to
    invoice = Invoice(place_of_supply=PlaceOfSupply(state_code="27"), lines=(_valid_line(),))
    service, invoice = _build(company, customer, invoice)
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    fields = {i.field for i in result.blocking}
    assert "customer.bill_to" in fields


def test_missing_place_of_supply_blocks() -> None:
    company = Company(name="Suntech")
    customer = Customer(name="Cust", bill_to=Address(line="x", state_code="27"))
    invoice = Invoice(lines=(_valid_line(),))  # no place_of_supply
    service, invoice = _build(company, customer, invoice)
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    assert any(i.field == "place_of_supply.state_code" for i in result.blocking)


def test_no_lines_blocks() -> None:
    company = Company(name="Suntech")
    customer = Customer(name="Cust", bill_to=Address(line="x", state_code="27"))
    invoice = Invoice(place_of_supply=PlaceOfSupply(state_code="27"))
    service, invoice = _build(company, customer, invoice)
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    assert any(i.field == "lines" for i in result.blocking)


def test_invalid_line_blocks() -> None:
    company = Company(name="Suntech")
    customer = Customer(name="Cust", bill_to=Address(line="x", state_code="27"))
    bad_line = _valid_line().model_copy(update={"quantity": Decimal("0")})
    invoice = Invoice(place_of_supply=PlaceOfSupply(state_code="27"), lines=(bad_line,))
    service, invoice = _build(company, customer, invoice)
    result = service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
    assert any(i.field == "lines[0].quantity" for i in result.blocking)


def test_due_date_before_invoice_date_blocks() -> None:
    service, invoice = _valid_setup()
    result = service.check_finalization_readiness(
        invoice, invoice_date=INVOICE_DATE, due_date=date(2026, 5, 1)
    )
    assert any(i.field == "due_date" for i in result.blocking)


def test_gate_requires_master_repositories() -> None:
    conn = sqlite3.connect(":memory:")
    service = InvoiceService(conn, InMemoryInvoiceRepository())  # no company/customer repos
    with pytest.raises(InvoiceServiceError):
        service.check_finalization_readiness(Invoice(), invoice_date=INVOICE_DATE)


def test_gate_rejects_non_draft() -> None:
    service, invoice = _valid_setup()
    finalized = invoice.model_copy(
        update={"status": InvoiceStatus.FINALIZED, "invoice_number": "SE/26-27/043"}
    )
    with pytest.raises(InvoiceServiceError):
        service.check_finalization_readiness(finalized, invoice_date=INVOICE_DATE)


def test_gate_requires_customer_selected() -> None:
    company = Company(name="Suntech")
    customer = Customer(name="Cust", bill_to=Address(line="x", state_code="27"))
    companies = InMemoryCompanyRepository()
    customers = InMemoryCustomerRepository()
    companies.save(company)
    customers.save(customer)
    conn = sqlite3.connect(":memory:")
    service = InvoiceService(
        conn,
        InMemoryInvoiceRepository(),
        company_repository=companies,
        customer_repository=customers,
    )
    invoice = Invoice(  # customer_id left None
        place_of_supply=PlaceOfSupply(state_code="27"), lines=(_valid_line(),)
    )
    with pytest.raises(InvoiceServiceError):
        service.check_finalization_readiness(invoice, invoice_date=INVOICE_DATE)
