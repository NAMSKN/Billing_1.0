"""Tests for the PDF references/logistics component (Task 34)."""

from __future__ import annotations

import io

from reportlab.platypus import Paragraph, SimpleDocTemplate, Table

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderParty,
    RenderReference,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.references import build_references
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(references: tuple[RenderReference, ...]) -> InvoiceRenderDTO:
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=True,
        company=RenderParty(name="Suntech"),
        bill_to=RenderParty(name="Cust"),
        ship_to=RenderParty(name="Cust"),
        references=references,
        lines=(),
        tax_summary=(),
        totals=RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
    )


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    flowables = build_references(dto)
    assert flowables, "this helper expects populated references"
    doc.build(flowables)
    return buf.getvalue()


def test_no_references_renders_nothing() -> None:
    assert build_references(_dto(())) == []


def test_populated_references_render() -> None:
    refs = (
        RenderReference("PO No.", "BMSS/L/070/26-27"),
        RenderReference("Vehicle No.", "MH48CQ5748"),
    )
    flowables = build_references(_dto(refs))
    assert len(flowables) == 1
    table = flowables[0]
    assert isinstance(table, Table)


def test_reference_cells_contain_label_and_value() -> None:
    refs = (RenderReference("Challan No.", "CHALLAN NO. 353"),)
    flowables = build_references(_dto(refs))
    table = flowables[0]
    assert isinstance(table, Table)
    # Collect Paragraph text from the table's cell values.
    texts: list[str] = []
    for row in table._cellvalues:  # type: ignore[attr-defined]
        for cell in row:
            if isinstance(cell, Paragraph):
                texts.append(cell.text)
    joined = " ".join(texts)
    assert "Challan No." in joined
    assert "CHALLAN NO. 353" in joined


def test_odd_number_of_references_pads_last_row() -> None:
    refs = (
        RenderReference("PO No.", "P-1"),
        RenderReference("Vehicle No.", "V-1"),
        RenderReference("Destination", "Pune"),
    )
    table = build_references(_dto(refs))[0]
    assert isinstance(table, Table)
    # 3 references -> 2 rows of 2 cells (last cell padded/empty).
    assert len(table._cellvalues) == 2  # type: ignore[attr-defined]
    assert all(len(row) == 2 for row in table._cellvalues)  # type: ignore[attr-defined]


def test_special_characters_escaped() -> None:
    refs = (RenderReference("Other References", "A & B <ref>"),)
    table = build_references(_dto(refs))[0]
    texts = [
        cell.text
        for row in table._cellvalues  # type: ignore[attr-defined]
        for cell in row
        if isinstance(cell, Paragraph)
    ]
    assert any("A &amp; B &lt;ref&gt;" in t for t in texts)


def test_populated_references_render_to_valid_pdf() -> None:
    refs = (RenderReference("PO No.", "P-1"), RenderReference("Vehicle No.", "V-1"))
    data = _render(_dto(refs))
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")
