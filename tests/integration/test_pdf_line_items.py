"""Tests for the PDF line-item table component (Task 35)."""

from __future__ import annotations

import io

from reportlab.platypus import Paragraph, SimpleDocTemplate, Table

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderLine,
    RenderParty,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.line_items import (
    _HEADERS,
    build_line_items,
)
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _line(**overrides: object) -> RenderLine:
    base: dict[str, object] = {
        "serial": 1,
        "job_or_mould": "DT-663",
        "operation": "Punch Gun Drilling",
        "description": "Gundrilling",
        "specification": "Drill Dia 9 x 307 mm Deep",
        "hsn_sac": "998898",
        "quantity": "16",
        "unit": "NOS",
        "rate": "767.50",
        "discount_percent": "0",
        "amount": "12,280.00",
    }
    base.update(overrides)
    return RenderLine(**base)  # type: ignore[arg-type]


def _dto(lines: tuple[RenderLine, ...]) -> InvoiceRenderDTO:
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
        references=(),
        lines=lines,
        tax_summary=(),
        totals=RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
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
    doc.build(build_line_items(dto))
    return buf.getvalue()


def test_header_row_present() -> None:
    table = build_line_items(_dto((_line(),)))[0]
    assert isinstance(table, Table)
    texts = _cell_texts(table)
    for header in _HEADERS:
        assert header in texts


def test_one_row_per_line() -> None:
    table = build_line_items(_dto((_line(serial=1), _line(serial=2))))[0]
    assert isinstance(table, Table)
    # header row + 2 line rows
    assert len(table._cellvalues) == 3  # type: ignore[attr-defined]


def test_line_cell_contents() -> None:
    table = build_line_items(_dto((_line(),)))[0]
    texts = " ".join(_cell_texts(table))
    assert "DT-663" in texts
    assert "Punch Gun Drilling" in texts
    assert "Gundrilling" in texts
    assert "Drill Dia 9 x 307 mm Deep" in texts
    assert "998898" in texts
    assert "12,280.00" in texts


def test_stacked_fields_use_line_break() -> None:
    table = build_line_items(_dto((_line(),)))[0]
    texts = _cell_texts(table)
    # Job + operation stacked with a <br/>.
    assert any("DT-663<br/>Punch Gun Drilling" in t for t in texts)


def test_empty_secondary_field_omitted_from_stack() -> None:
    table = build_line_items(_dto((_line(operation="", specification=""),))) [0]
    texts = _cell_texts(table)
    assert any(t == "DT-663" for t in texts)  # no trailing <br/>
    assert any(t == "Gundrilling" for t in texts)


def test_many_lines_render() -> None:
    lines = tuple(_line(serial=i) for i in range(1, 31))
    data = _render(_dto(lines))
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")


def test_long_specification_wraps_without_error() -> None:
    long_spec = "Very long specification with many dimensions " * 10
    data = _render(_dto((_line(specification=long_spec),)))
    assert data.startswith(b"%PDF-")


def test_special_characters_render() -> None:
    line = _line(description="A & B <special>", specification="Size 10 x 20")
    table = build_line_items(_dto((line,)))[0]
    texts = _cell_texts(table)
    assert any("A &amp; B &lt;special&gt;" in t for t in texts)
    # Render with the rupee and multiplication characters present.
    data = _render(_dto((_line(rate="\u20b9767.50", specification="510 \u00d7 430 \u00d7 130"),)))
    assert data.startswith(b"%PDF-")
