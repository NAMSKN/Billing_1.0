"""Unit tests for draft vs finalization validation."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.domain.validation import (
    Severity,
    is_valid_email,
    is_valid_gstin,
    is_valid_ifsc,
    validate_draft,
    validate_for_finalization,
    validate_line,
)

VALID_GSTIN = "27ABCDE1234F1Z5"
VALID_IFSC = "HDFC0001234"


# --- Format validators (offline) ---


@pytest.mark.parametrize("value", [VALID_GSTIN, "07AAACH7409R1ZZ"])
def test_valid_gstin(value: str) -> None:
    assert is_valid_gstin(value) is True


@pytest.mark.parametrize("value", ["", "27ABCDE1234F1Z", "abcde", "271234567890123"])
def test_invalid_gstin(value: str) -> None:
    assert is_valid_gstin(value) is False


@pytest.mark.parametrize("value", [VALID_IFSC, "SBIN0000123"])
def test_valid_ifsc(value: str) -> None:
    assert is_valid_ifsc(value) is True


@pytest.mark.parametrize("value", ["", "HDFC1234567", "HDF0001234", "hdfc0001234"])
def test_invalid_ifsc(value: str) -> None:
    assert is_valid_ifsc(value) is False


@pytest.mark.parametrize("value", ["a@b.co", "name.surname@example.in"])
def test_valid_email(value: str) -> None:
    assert is_valid_email(value) is True


@pytest.mark.parametrize("value", ["", "no-at-sign", "a@b", "a b@c.com"])
def test_invalid_email(value: str) -> None:
    assert is_valid_email(value) is False


# --- Helpers ---


def _valid_line() -> InvoiceLine:
    return InvoiceLine(
        description="6 Side Machining",
        hsn_sac="998898",
        quantity=Decimal("16"),
        unit="NOS",
        rate=Decimal("767.50"),
        discount_percent=Decimal("0"),
        tax_rate=Decimal("18"),
    )


def _valid_company() -> Company:
    return Company(name="Suntech Enterprises", gstin=VALID_GSTIN, ifsc=VALID_IFSC)


def _valid_customer() -> Customer:
    return Customer(
        name="BMSS Steel",
        bill_to=Address(line="12 Industrial Rd", state_name="Maharashtra", state_code="27"),
    )


# --- Draft (permissive) ---


def test_draft_allows_incomplete_with_warnings_not_blocking() -> None:
    result = validate_draft(Invoice())
    assert result.is_ok is True  # no blocking issues
    assert any(i.severity is Severity.WARNING for i in result.issues)
    assert any(i.field == "lines" for i in result.warnings)


def test_draft_blocks_malformed_gstin_even_when_incomplete() -> None:
    company = Company(gstin="INVALID")
    result = validate_draft(Invoice(), company=company)
    assert result.is_ok is False
    assert any(i.field == "company.gstin" for i in result.blocking)


def test_draft_missing_invoice_date_is_warning() -> None:
    result = validate_draft(Invoice(), invoice_date=None)
    assert result.is_ok is True
    assert any(i.field == "invoice_date" and i.severity is Severity.WARNING for i in result.issues)


# --- Finalization (strict) ---


def test_finalization_passes_for_valid_invoice() -> None:
    invoice = Invoice(
        place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
        lines=(_valid_line(),),
    )
    result = validate_for_finalization(
        invoice,
        company=_valid_company(),
        customer=_valid_customer(),
        invoice_date=date(2026, 5, 11),
    )
    assert result.is_ok is True
    assert result.blocking == ()


def test_finalization_blocks_missing_company_name() -> None:
    invoice = Invoice(
        place_of_supply=PlaceOfSupply(state_code="27"),
        lines=(_valid_line(),),
    )
    result = validate_for_finalization(
        invoice,
        company=Company(name=""),
        customer=_valid_customer(),
        invoice_date=date(2026, 5, 11),
    )
    assert result.is_ok is False
    assert any(i.field == "company.name" for i in result.blocking)


def test_finalization_blocks_missing_customer_and_lines() -> None:
    invoice = Invoice(place_of_supply=PlaceOfSupply(state_code="27"))
    result = validate_for_finalization(
        invoice,
        company=_valid_company(),
        customer=Customer(name=""),
        invoice_date=date(2026, 5, 11),
    )
    fields = {i.field for i in result.blocking}
    assert "customer.name" in fields
    assert "customer.bill_to" in fields
    assert "lines" in fields


def test_finalization_blocks_missing_place_of_supply() -> None:
    invoice = Invoice(lines=(_valid_line(),))  # no place_of_supply
    result = validate_for_finalization(
        invoice,
        company=_valid_company(),
        customer=_valid_customer(),
        invoice_date=date(2026, 5, 11),
    )
    assert any(i.field == "place_of_supply.state_code" for i in result.blocking)


def test_due_date_before_invoice_date_blocks() -> None:
    invoice = Invoice(
        place_of_supply=PlaceOfSupply(state_code="27"),
        lines=(_valid_line(),),
    )
    result = validate_for_finalization(
        invoice,
        company=_valid_company(),
        customer=_valid_customer(),
        invoice_date=date(2026, 5, 11),
        due_date=date(2026, 5, 1),
    )
    assert any(i.field == "due_date" for i in result.blocking)


def test_future_invoice_date_is_warning_not_blocking() -> None:
    invoice = Invoice(
        place_of_supply=PlaceOfSupply(state_code="27"),
        lines=(_valid_line(),),
    )
    result = validate_for_finalization(
        invoice,
        company=_valid_company(),
        customer=_valid_customer(),
        invoice_date=date(2026, 6, 1),
        today=date(2026, 5, 11),
    )
    assert result.is_ok is True  # future date does not block (Q-001)
    assert any(i.field == "invoice_date" and i.severity is Severity.WARNING for i in result.issues)


# --- Line validation ---


def test_line_requires_description_when_strict() -> None:
    line = _valid_line().model_copy(update={"description": ""})
    issues = validate_line(line, index=0, strict=True)
    assert any(
        i.field == "lines[0].description" and i.severity is Severity.BLOCKING for i in issues
    )


def test_line_missing_description_is_warning_in_draft() -> None:
    line = _valid_line().model_copy(update={"description": ""})
    issues = validate_line(line, index=0, strict=False)
    assert any(i.field == "lines[0].description" and i.severity is Severity.WARNING for i in issues)


def test_line_requires_hsn_for_taxable() -> None:
    line = _valid_line().model_copy(update={"hsn_sac": ""})
    issues = validate_line(line, index=0, strict=True)
    assert any(i.field == "lines[0].hsn_sac" for i in issues)


def test_line_quantity_must_be_positive() -> None:
    line = _valid_line().model_copy(update={"quantity": Decimal("0")})
    issues = validate_line(line, index=0, strict=True)
    assert any(i.field == "lines[0].quantity" and i.severity is Severity.BLOCKING for i in issues)


def test_line_rate_not_negative() -> None:
    line = _valid_line().model_copy(update={"rate": Decimal("-1")})
    issues = validate_line(line, index=0, strict=True)
    assert any(i.field == "lines[0].rate" for i in issues)


@pytest.mark.parametrize("discount", [Decimal("-1"), Decimal("101")])
def test_line_discount_out_of_range_blocks(discount: Decimal) -> None:
    line = _valid_line().model_copy(update={"discount_percent": discount})
    issues = validate_line(line, index=0, strict=True)
    assert any(i.field == "lines[0].discount_percent" for i in issues)


@pytest.mark.parametrize("discount", [Decimal("0"), Decimal("50"), Decimal("100")])
def test_line_discount_in_range_ok(discount: Decimal) -> None:
    line = _valid_line().model_copy(update={"discount_percent": discount})
    issues = validate_line(line, index=0, strict=True)
    assert not any(i.field == "lines[0].discount_percent" for i in issues)


def test_malformed_numeric_blocks_even_in_draft() -> None:
    line = _valid_line().model_copy(update={"quantity": Decimal("0")})
    issues = validate_line(line, index=0, strict=False)
    # Malformed numeric is blocking regardless of draft/finalize.
    assert any(i.field == "lines[0].quantity" and i.severity is Severity.BLOCKING for i in issues)
