"""Mould / machining line-item table (Task 35).

The most important table on the invoice (PDF_LAYOUT sections 11-16). Columns:
#, Job / Operation, Description / Specification, HSN/SAC, Qty, Unit, Rate,
Disc %, Amount. Text columns wrap via Paragraph flowables so long technical
descriptions are never clipped (Req 19.3); numeric columns are right-aligned;
HSN/SAC and Unit are centered. Special characters (& < > and, in values, ₹/×)
are handled via XML-escaping (Req 19.4).

Job/Mould + Operation are stacked in one cell and Description + Specification in
another (permitted by PDF_LAYOUT section 11) to keep the table readable on A4
while preserving all technical information. Consumes only the render DTO
(DECISIONS D-011).
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO, RenderLine
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    table_cell_bold_style,
    table_cell_style,
    table_header_style,
)

_HEADER_BG = colors.HexColor("#EEEEEE")

# Proportional column widths (sum ~= 1.0) across the printable width.
_COL_WIDTHS: tuple[str, ...] = ("4%", "20%", "31%", "10%", "7%", "6%", "10%", "6%", "6%")

_HEADERS: tuple[str, ...] = (
    "#",
    "Job / Operation",
    "Description / Specification",
    "HSN/SAC",
    "Qty",
    "Unit",
    "Rate",
    "Disc %",
    "Amount",
)


def build_line_items(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the line-item table flowables for ``dto``."""
    rows: list[list[Flowable]] = [_header_row()]
    for line in dto.lines:
        rows.append(_line_row(line))

    table = Table(rows, colWidths=list(_COL_WIDTHS), repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, COLOR_RULE),
                ("LINEBELOW", (0, 1), (-1, -1), 0.25, COLOR_RULE),
                ("BOX", (0, 0), (-1, -1), 0.5, COLOR_RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return [table]


def _header_row() -> list[Flowable]:
    style = table_header_style()
    return [Paragraph(escape(h), style) for h in _HEADERS]


def _line_row(line: RenderLine) -> list[Flowable]:
    left = table_cell_style(TA_LEFT)
    center = table_cell_style(TA_CENTER)
    right = table_cell_style(TA_RIGHT)
    amount = table_cell_bold_style(TA_RIGHT)

    return [
        Paragraph(str(line.serial), center),
        Paragraph(_stacked(line.job_or_mould, line.operation), left),
        Paragraph(_stacked(line.description, line.specification), left),
        Paragraph(escape(line.hsn_sac), center),
        Paragraph(escape(line.quantity), right),
        Paragraph(escape(line.unit), center),
        Paragraph(escape(line.rate), right),
        Paragraph(escape(line.discount_percent), right),
        Paragraph(escape(line.amount), amount),
    ]


def _stacked(primary: str, secondary: str) -> str:
    """Escape and stack two fields with a line break, omitting empties."""
    parts = [escape(p) for p in (primary, secondary) if p]
    return "<br/>".join(parts)


__all__ = ["build_line_items"]
