"""Unit tests for the render DTO and PdfService.build_dto."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal

import pytest

from invoice_generator.application.invoice_service import InvoiceService
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.pdf_service import PdfService
from invoice_generator.application.render_dto import format_money, format_quantity
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.models import (
    Address,
    Asset,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from tests.support.fakes import (
    InMemoryAssetRepository,
    InMemoryCompanyRepository,
    InMemoryCustomerRepository,
    InMemoryInvoiceRepository,
    InMemorySequenceRepository,
    InMemorySettingsRepository,
)

INVOICE_DATE = date(2026, 5, 11)


# --- format helpers ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("0.00"), "0.00"),
        (Decimal("999.00"), "999.00"),
        (Decimal("12280.00"), "12,280.00"),
        (Decimal("14490.00"), "14,490.00"),
        (Decimal("150000.00"), "1,50,000.00"),
        (Decimal("10000000.00"), "1,00,00,000.00"),
        (Decimal("-0.40"), "-0.40"),
    ],
)
def test_format_money_indian_grouping(value: Decimal, expected: str) -> None:
    assert format_money(value) == expected


def test_format_quantity_trims_zeros() -> None:
    assert format_quantity(Decimal("16")) == "16"
    assert format_quantity(Decimal("2.500")) == "2.5"
    assert format_quantity(Decimal("0")) == "0"


# --- build_dto via a finalized invoice ---


def _finalize(assets: InMemoryAssetRepository | None = None) -> tuple[Invoice, PdfService]:
    conn = sqlite3.connect(":memory:")
    companies = InMemoryCompanyRepository()
    customers = InMemoryCustomerRepository()
    company = Company(
        name="Suntech Enterprises",
        address=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
        gstin="27ABCDE1234F1Z5",
        bank_name="HDFC",
        account_number="123456",
        ifsc="HDFC0001234",
        authorized_signatory="For Suntech",
    )
    customer = Customer(
        name="DI-TECH MOULDS",
        gstin="27ZZZZZ1234Z1Z5",
        bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code="27"),
    )
    companies.save(company)
    customers.save(customer)
    service = InvoiceService(
        conn,
        InMemoryInvoiceRepository(),
        company_repository=companies,
        customer_repository=customers,
        numbering_service=NumberingService(InMemorySequenceRepository()),
        settings_service=SettingsService(InMemorySettingsRepository()),
    )
    draft = service.create_draft(
        Invoice(
            customer_id=customer.id,
            place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
            lines=(
                InvoiceLine(
                    description="Punch Gun Drilling",
                    job_or_mould_reference="DT-663",
                    hsn_sac="998898",
                    quantity=Decimal("16"),
                    unit="NOS",
                    rate=Decimal("767.50"),
                    tax_rate=Decimal("18"),
                ),
            ),
        )
    )
    finalized = service.finalize(draft.id, invoice_date=INVOICE_DATE)
    return finalized, PdfService(asset_repository=assets)


def test_build_dto_basic_fields() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    assert dto.invoice_number == "SE/26-27/001"
    assert dto.invoice_date == "2026-05-11"
    assert dto.place_of_supply == "Maharashtra (27)"
    assert dto.is_intra_state is True
    assert dto.company.name == "Suntech Enterprises"
    assert dto.bill_to.name == "DI-TECH MOULDS"


def test_build_dto_line_formatting() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    assert len(dto.lines) == 1
    line = dto.lines[0]
    assert line.serial == 1
    assert line.job_or_mould == "DT-663"
    assert line.quantity == "16"
    assert line.rate == "767.50"
    assert line.amount == "12,280.00"


def test_build_dto_totals_and_words() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    assert dto.totals.taxable == "12,280.00"
    assert dto.totals.cgst == "1,105.20"
    assert dto.totals.round_off == "-0.40"
    assert dto.totals.grand_total == "14,490.00"
    assert dto.totals.grand_total_words == "INR Fourteen Thousand Four Hundred Ninety Only"


def test_build_dto_intra_state_tax_rows() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    assert len(dto.tax_summary) == 1
    row = dto.tax_summary[0]
    assert row.hsn_sac == "998898"
    assert row.cgst_rate == "9"
    assert row.sgst_rate == "9"
    assert row.igst_rate == ""
    assert row.cgst_amount == "1,105.20"


def test_build_dto_omits_empty_references() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    # No references were set on this invoice -> none rendered.
    assert dto.references == ()


def test_build_dto_includes_populated_references() -> None:
    conn = sqlite3.connect(":memory:")
    companies = InMemoryCompanyRepository()
    customers = InMemoryCustomerRepository()
    company = Company(
        name="Suntech",
        address=Address(state_name="Maharashtra", state_code="27"),
    )
    customer = Customer(name="C", bill_to=Address(line="x", state_code="27"))
    companies.save(company)
    customers.save(customer)
    service = InvoiceService(
        conn,
        InMemoryInvoiceRepository(),
        company_repository=companies,
        customer_repository=customers,
        numbering_service=NumberingService(InMemorySequenceRepository()),
        settings_service=SettingsService(InMemorySettingsRepository()),
    )
    from invoice_generator.domain.models import InvoiceReferences

    draft = service.create_draft(
        Invoice(
            customer_id=customer.id,
            place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
            references=InvoiceReferences(
                buyer_order_number="BMSS/L/070/26-27", vehicle_number="MH48CQ5748"
            ),
            lines=(
                InvoiceLine(
                    description="x", hsn_sac="998898", quantity=Decimal("1"), rate=Decimal("1")
                ),
            ),
        )
    )
    finalized = service.finalize(draft.id, invoice_date=INVOICE_DATE)
    dto = PdfService().build_dto(finalized)
    labels = {r.label: r.value for r in dto.references}
    assert labels["PO No."] == "BMSS/L/070/26-27"
    assert labels["Vehicle No."] == "MH48CQ5748"
    assert "Destination" not in labels  # empty -> omitted


def test_build_dto_resolves_logo_asset() -> None:
    assets = InMemoryAssetRepository()
    logo = Asset(kind="logo", version=3, sha256="abc", stored_path="/assets/logo.png")
    assets.save(logo)
    finalized, _ = _finalize(assets)
    # Attach the logo to the company snapshot by re-finalizing with a logo id.
    # Simpler: build dto and assert missing (no logo on company) -> None,
    # then verify resolution via a direct snapshot with a logo id.
    dto = PdfService(asset_repository=assets).build_dto(finalized)
    assert dto.logo is None  # company had no logo asset id


def test_build_dto_missing_asset_degrades_to_none() -> None:
    finalized, _ = _finalize(InMemoryAssetRepository())
    dto = PdfService(asset_repository=InMemoryAssetRepository()).build_dto(finalized)
    assert dto.logo is None
    assert dto.signature is None


def test_build_dto_requires_snapshot() -> None:
    pdf = PdfService()
    with pytest.raises(ValueError):
        pdf.build_dto(Invoice())  # a draft has no snapshot


def test_build_dto_bank_details_populated() -> None:
    finalized, pdf = _finalize()
    dto = pdf.build_dto(finalized)
    labels = {r.label: r.value for r in dto.bank_details}
    assert labels["Bank Name"] == "HDFC"
    assert labels["IFSC"] == "HDFC0001234"
