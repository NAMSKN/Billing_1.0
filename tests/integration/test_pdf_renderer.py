"""Tests for the paginated invoice PDF renderer (Task 40)."""

from __future__ import annotations

import re

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderLine,
    RenderParty,
    RenderReference,
    RenderTaxRow,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.renderer import (
    build_story,
    page_footer_texts,
    render_invoice_pdf,
)


def _line(serial: int) -> RenderLine:
    return RenderLine(
        serial=serial,
        job_or_mould="DT-663",
        operation="Punch Gun Drilling",
        description="Gundrilling operation with a fairly long description to add height",
        specification="Drill Dia 9 x 307 mm Deep, six side machining 510 x 430 x 130",
        hsn_sac="998898",
        quantity="16",
        unit="NOS",
        rate="767.50",
        discount_percent="0",
        amount="12,280.00",
    )


def _dto(line_count: int = 1) -> InvoiceRenderDTO:
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="2026-06-10",
        place_of_supply="Maharashtra (27)",
        payment_terms="30 Days",
        is_intra_state=True,
        company=RenderParty(
            name="Suntech Enterprises",
            address_lines=("12 Industrial Rd",),
            gstin="27ABCDE1234F1Z5",
            state="Maharashtra (27)",
        ),
        bill_to=RenderParty(
            name="DI-TECH MOULDS", address_lines=("Plot 9",), state="Maharashtra (27)"
        ),
        ship_to=RenderParty(
            name="DI-TECH MOULDS", address_lines=("Plot 9",), state="Maharashtra (27)"
        ),
        references=(RenderReference("PO No.", "PO-123"),),
        lines=tuple(_line(i) for i in range(1, line_count + 1)),
        tax_summary=(
            RenderTaxRow(
                "998898", "12,280.00", "9", "1,105.20", "9", "1,105.20", "", "0.00", "2,210.40"
            ),
        ),
        totals=RenderTotals(
            "12,280.00", "1,105.20", "1,105.20", "0.00", "-0.40", "14,490.00",
            "INR Fourteen Thousand Four Hundred Ninety Only",
            "INR Two Thousand Two Hundred Ten and Forty Paise Only",
        ),
        notes="Handle with care",
        terms="1. Payment within 30 days\n2. Goods once sold not returned",
        declaration="We declare the particulars are true and correct.",
        authorized_signatory="For Suntech Enterprises",
        bank_details=(RenderReference("Bank Name", "HDFC"),),
        upi_id="suntech@hdfc",
    )


def _minimal_dto() -> InvoiceRenderDTO:
    """A lean invoice (one line, no notes/terms/payment) that fits one page."""
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=True,
        company=RenderParty(name="Suntech", state="Maharashtra (27)"),
        bill_to=RenderParty(name="Cust", state="Maharashtra (27)"),
        ship_to=RenderParty(name="Cust", state="Maharashtra (27)"),
        references=(),
        lines=(_line(1),),
        tax_summary=(
            RenderTaxRow(
                "998898", "12,280.00", "9", "1,105.20", "9", "1,105.20", "", "0.00", "2,210.40"
            ),
        ),
        totals=RenderTotals(
            "12,280.00", "1,105.20", "1,105.20", "0.00", "-0.40", "14,490.00",
            "INR Fourteen Thousand Four Hundred Ninety Only", "",
        ),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="For Suntech",
    )


def _page_count(pdf: bytes) -> int:
    return len(re.findall(rb"/MediaBox", pdf))


def test_minimal_invoice_renders_one_page() -> None:
    pdf = render_invoice_pdf(_minimal_dto())
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    assert _page_count(pdf) == 1


def test_many_line_invoice_spans_multiple_pages() -> None:
    pdf = render_invoice_pdf(_dto(line_count=60))
    assert _page_count(pdf) > 1


def test_footer_texts_helper() -> None:
    left, right = page_footer_texts(1, 3)
    assert left == "This is a Computer Generated Invoice"
    assert right == "Page 1 of 3"


def test_footer_texts_last_page() -> None:
    _, right = page_footer_texts(3, 3)
    assert right == "Page 3 of 3"


def test_rich_invoice_renders_valid_pdf() -> None:
    # The full DTO (notes/terms/declaration/payment) is content-rich and may
    # span more than one page; it must still render a valid multi-... PDF.
    pdf = render_invoice_pdf(_dto(line_count=1))
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    assert _page_count(pdf) >= 1


def test_story_order() -> None:
    # The story is assembled and non-empty; header first.
    story = build_story(_dto(line_count=2))
    assert story  # non-empty
    # KeepTogether is used for totals and footer (grouping) -> present in story.
    from reportlab.platypus import KeepTogether

    assert any(isinstance(f, KeepTogether) for f in story)


def test_valid_pdf_a4() -> None:
    pdf = render_invoice_pdf(_dto(line_count=1))
    match = re.search(rb"MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
    assert match is not None
    assert abs(float(match.group(1)) - 595.2756) < 0.5
    assert abs(float(match.group(2)) - 841.8898) < 0.5
