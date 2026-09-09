"""Tests for the PDF totals/words component (Task 37)."""

from __future__ import annotations

import io

from reportlab.platypus import Paragraph, SimpleDocTemplate

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderParty,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.totals import build_totals
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(*, is_intra: bool = True, **totals_overrides: str) -> InvoiceRenderDTO:
    totals_kwargs: dict[str, str] = {
        "taxable": "12,280.00",
        "cgst": "1,105.20",
        "sgst": "1,105.20",
        "igst": "0.00",
        "round_off": "-0.40",
        "grand_total": "14,490.00",
        "grand_total_words": "INR Fourteen Thousand Four Hundred Ninety Only",
        "tax_amount_words": "INR Two Thousand Two Hundred Ten and Forty Paise Only",
    }
    totals_kwargs.update(totals_overrides)
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=is_intra,
        company=RenderParty(name="Suntech"),
        bill_to=RenderParty(name="Cust"),
        ship_to=RenderParty(name="Cust"),
        references=(),
        lines=(),
        tax_summary=(),
        totals=RenderTotals(**totals_kwargs),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
    )


def _all_paragraphs(flowables: list[object]) -> list[Paragraph]:
    out: list[Paragraph] = []
    for f in flowables:
        if isinstance(f, Paragraph):
            out.append(f)
        elif hasattr(f, "_cellvalues"):
            for row in f._cellvalues:  # type: ignore[attr-defined]
                for cell in row:
                    if isinstance(cell, Paragraph):
                        out.append(cell)
    return out


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_totals(dto))
    return buf.getvalue()


def test_intra_shows_cgst_sgst_hides_igst() -> None:
    paras = _all_paragraphs(build_totals(_dto(is_intra=True)))
    texts = [p.text for p in paras]
    assert any(t == "CGST" for t in texts)
    assert any(t == "SGST" for t in texts)
    assert not any(t == "IGST" for t in texts)


def test_inter_shows_igst_hides_cgst_sgst() -> None:
    paras = _all_paragraphs(build_totals(_dto(is_intra=False)))
    texts = [p.text for p in paras]
    assert any(t == "IGST" for t in texts)
    assert not any(t == "CGST" for t in texts)
    assert not any(t == "SGST" for t in texts)


def test_grand_total_present_and_value() -> None:
    paras = _all_paragraphs(build_totals(_dto()))
    texts = [p.text for p in paras]
    assert any(t == "GRAND TOTAL" for t in texts)
    assert any(t == "14,490.00" for t in texts)


def test_grand_total_is_most_prominent() -> None:
    paras = _all_paragraphs(build_totals(_dto()))
    grand = [p for p in paras if p.text in ("GRAND TOTAL", "14,490.00")]
    others = [p for p in paras if p.text not in ("GRAND TOTAL", "14,490.00")]
    grand_size = max(p.style.fontSize for p in grand)
    max_other = max(p.style.fontSize for p in others)
    assert grand_size > max_other  # grand total uses the largest font


def test_amount_in_words_present() -> None:
    paras = _all_paragraphs(build_totals(_dto()))
    joined = " ".join(p.text for p in paras)
    assert "Amount in Words:" in joined
    assert "INR Fourteen Thousand Four Hundred Ninety Only" in joined


def test_tax_amount_in_words_present() -> None:
    paras = _all_paragraphs(build_totals(_dto()))
    joined = " ".join(p.text for p in paras)
    assert "Tax Amount in Words:" in joined
    assert "Forty Paise Only" in joined


def test_round_off_shown() -> None:
    paras = _all_paragraphs(build_totals(_dto()))
    texts = [p.text for p in paras]
    assert any(t == "Round Off" for t in texts)
    assert any(t == "-0.40" for t in texts)


def test_renders_to_valid_pdf() -> None:
    data = _render(_dto())
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")
