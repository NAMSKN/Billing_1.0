"""End-to-end PDF regression tests against the golden invoices (Task 42).

Renders finalized golden invoices through the full pipeline
(finalize -> PdfService.build_dto -> renderer.render_invoice_pdf) and asserts
the PDF opens, is A4, and contains the required text and golden totals. Reprint
equivalence is asserted at the **content** level (structured render DTO +
extracted text), never by byte-for-byte PDF comparison (DECISIONS D-031).

These are aggregate golden fixtures (Q-013): each invoice is modeled with a
single representative line reproducing the documented aggregate taxable value;
the true per-line source split is not fabricated.
"""

from __future__ import annotations

import io
import re
import sqlite3
from datetime import date
from decimal import Decimal

import pytest
from pypdf import PdfReader

from invoice_generator.application.invoice_service import InvoiceService
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.pdf_service import PdfService
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.infrastructure.pdf.renderer import render_invoice_pdf
from tests.fixtures.golden_invoices import GOLDEN_043, GOLDEN_089, AggregateGoldenInvoice
from tests.support.fakes import (
    InMemoryCompanyRepository,
    InMemoryCustomerRepository,
    InMemoryInvoiceRepository,
    InMemorySequenceRepository,
    InMemorySettingsRepository,
)

INVOICE_DATE = date(2026, 5, 11)


def _finalize_golden(golden: AggregateGoldenInvoice) -> Invoice:
    """Finalize an intra-state invoice whose single line yields the aggregate
    taxable value (representative, not the fabricated source split; Q-013)."""
    conn = sqlite3.connect(":memory:")
    companies = InMemoryCompanyRepository()
    customers = InMemoryCustomerRepository()
    companies.save(
        Company(
            name="Suntech Enterprises",
            address=Address(state_name="Maharashtra", state_code="27"),
        )
    )
    customer = Customer(
        name=golden.customer,
        bill_to=Address(line="Plot 9, MIDC", state_name="Maharashtra", state_code="27"),
    )
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
                    description="Machining charges",
                    hsn_sac="998898",
                    quantity=Decimal("1"),
                    unit="NOS",
                    rate=golden.taxable,  # qty 1 x rate -> aggregate taxable
                    tax_rate=Decimal("18"),
                ),
            ),
        )
    )
    return service.finalize(draft.id, invoice_date=INVOICE_DATE)


def _render(golden: AggregateGoldenInvoice) -> bytes:
    return render_invoice_pdf(PdfService().build_dto(_finalize_golden(golden)))


def _extract_text(pdf: bytes) -> str:
    return "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)


@pytest.mark.parametrize("golden", [GOLDEN_043, GOLDEN_089], ids=lambda g: g.invoice_number)
def test_pdf_opens_and_is_a4(golden: AggregateGoldenInvoice) -> None:
    pdf = _render(golden)
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    match = re.search(rb"MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
    assert match is not None
    assert abs(float(match.group(1)) - 595.2756) < 0.5
    assert abs(float(match.group(2)) - 841.8898) < 0.5


@pytest.mark.parametrize("golden", [GOLDEN_043, GOLDEN_089], ids=lambda g: g.invoice_number)
def test_pdf_single_page(golden: AggregateGoldenInvoice) -> None:
    pdf = _render(golden)
    assert len(re.findall(rb"/MediaBox", pdf)) == 1


@pytest.mark.parametrize("golden", [GOLDEN_043, GOLDEN_089], ids=lambda g: g.invoice_number)
def test_required_text_present(golden: AggregateGoldenInvoice) -> None:
    text = _extract_text(_render(golden))
    assert "TAX INVOICE" in text
    # The rendered number is freshly allocated (SE/26-27/NNN), not the golden's
    # original real-world number; assert a well-formed number is present.
    assert re.search(r"SE/\d{2}-\d{2}/\d{3,}", text) is not None
    assert golden.customer in text
    assert "998898" in text
    assert "GRAND TOTAL" in text


@pytest.mark.parametrize("golden", [GOLDEN_043, GOLDEN_089], ids=lambda g: g.invoice_number)
def test_golden_totals_present_in_pdf(golden: AggregateGoldenInvoice) -> None:
    text = _extract_text(_render(golden))
    # Values are rendered with Indian grouping and 2 dp.
    assert _grouped(golden.taxable) in text
    assert _grouped(golden.cgst) in text
    assert _grouped(golden.sgst) in text
    assert _grouped(golden.grand_total) in text


def test_reprint_content_equivalence_not_byte_equality() -> None:
    # Two renders of the same finalized invoice: content-equivalent (structured
    # DTO + extracted text), even if the PDF bytes differ (D-031).
    invoice = _finalize_golden(GOLDEN_043)
    dto1 = PdfService().build_dto(invoice)
    dto2 = PdfService().build_dto(invoice)
    assert dto1 == dto2  # authoritative content is identical

    pdf1 = render_invoice_pdf(dto1)
    pdf2 = render_invoice_pdf(dto2)
    assert _extract_text(pdf1) == _extract_text(pdf2)  # same rendered content
    # We deliberately do NOT assert pdf1 == pdf2 (byte equality is not required).


def test_grand_total_words_present() -> None:
    text = _extract_text(_render(GOLDEN_043))
    assert "Fourteen Thousand Four Hundred Ninety" in text


def _grouped(amount: Decimal) -> str:
    """Format like the renderer (Indian grouping, 2 dp) for text search."""
    from invoice_generator.application.render_dto import format_money

    return format_money(amount)
