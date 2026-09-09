"""Tests for the PDF tax-summary component (Task 36)."""

from __future__ import annotations

import io

from reportlab.platypus import Paragraph, SimpleDocTemplate, Table

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderParty,
    RenderTaxRow,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.tax_summary import build_tax_summary
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(rows: tuple[RenderTaxRow, ...], *, is_intra: bool) -> InvoiceRenderDTO:
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
        tax_summary=rows,
        totals=RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
    )


def _intra_row() -> RenderTaxRow:
    return RenderTaxRow(
        hsn_sac="998898",
        taxable_value="12,280.00",
        cgst_rate="9",
        cgst_amount="1,105.20",
        sgst_rate="9",
        sgst_amount="1,105.20",
        igst_rate="",
        igst_amount="0.00",
        total_tax="2,210.40",
    )


def _inter_row() -> RenderTaxRow:
    return RenderTaxRow(
        hsn_sac="998898",
        taxable_value="12,280.00",
        cgst_rate="",
        cgst_amount="0.00",
        sgst_rate="",
        sgst_amount="0.00",
        igst_rate="18",
        igst_amount="2,210.40",
        total_tax="2,210.40",
    )


def _cell_texts(table: Table) -> list[str]:
    return [
        cell.text
        for row in table._cellvalues  # type: ignore[attr-defined]
        for cell in row
        if isinstance(cell, Paragraph)
    ]


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_tax_summary(dto))
    return buf.getvalue()


def test_no_rows_renders_nothing() -> None:
    assert build_tax_summary(_dto((), is_intra=True)) == []


def test_intra_state_columns_and_values() -> None:
    table = build_tax_summary(_dto((_intra_row(),), is_intra=True))[0]
    assert isinstance(table, Table)
    texts = _cell_texts(table)
    # Intra headers include CGST/SGST, exclude IGST.
    assert "CGST Rate" in texts
    assert "SGST Amt" in texts
    assert not any("IGST" in t for t in texts)
    # Values match the engine output.
    assert "12,280.00" in texts
    assert texts.count("1,105.20") == 2
    assert "2,210.40" in texts


def test_inter_state_columns_and_values() -> None:
    table = build_tax_summary(_dto((_inter_row(),), is_intra=False))[0]
    texts = _cell_texts(table)
    assert "IGST Rate" in texts
    assert "IGST Amt" in texts
    assert not any("CGST" in t for t in texts)
    assert not any("SGST" in t for t in texts)
    assert "2,210.40" in texts


def test_intra_row_has_seven_columns() -> None:
    table = build_tax_summary(_dto((_intra_row(),), is_intra=True))[0]
    assert all(len(row) == 7 for row in table._cellvalues)  # type: ignore[attr-defined]


def test_inter_row_has_five_columns() -> None:
    table = build_tax_summary(_dto((_inter_row(),), is_intra=False))[0]
    assert all(len(row) == 5 for row in table._cellvalues)  # type: ignore[attr-defined]


def test_multiple_hsn_rows() -> None:
    rows = (
        _intra_row(),
        RenderTaxRow("998877", "2,000.00", "9", "180.00", "9", "180.00", "", "0.00", "360.00"),
    )
    table = build_tax_summary(_dto(rows, is_intra=True))[0]
    # header + 2 rows
    assert len(table._cellvalues) == 3  # type: ignore[attr-defined]


def test_renders_to_valid_pdf() -> None:
    data = _render(_dto((_intra_row(),), is_intra=True))
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")
