"""Tax summary block (Task 36).

Renders the HSN/SAC-wise tax summary after the line-item table (PDF_LAYOUT
section 17). The column set adapts to the tax mode: intra-state shows CGST and
SGST rate/amount columns; inter-state shows IGST rate/amount — irrelevant
zero-value columns are not shown (PDF_LAYOUT section 17). Values come from the
render DTO, which the engine produced and reconciled to invoice totals
(Task 10); this component only lays them out (DECISIONS D-011).
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO, RenderTaxRow
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    table_cell_bold_style,
    table_cell_style,
    table_header_style,
)

_HEADER_BG = colors.HexColor("#EEEEEE")

_INTRA_HEADERS = (
    "HSN/SAC",
    "Taxable Value",
    "CGST Rate",
    "CGST Amt",
    "SGST Rate",
    "SGST Amt",
    "Total Tax",
)
_INTER_HEADERS = (
    "HSN/SAC",
    "Taxable Value",
    "IGST Rate",
    "IGST Amt",
    "Total Tax",
)


def build_tax_summary(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the tax-summary flowables, or an empty list if there are no rows."""
    if not dto.tax_summary:
        return []

    headers = _INTRA_HEADERS if dto.is_intra_state else _INTER_HEADERS
    rows: list[list[Flowable]] = [_header_row(headers)]
    for row in dto.tax_summary:
        rows.append(_row(row, is_intra=dto.is_intra_state))

    table = Table(rows, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, COLOR_RULE),
                ("BOX", (0, 0), (-1, -1), 0.5, COLOR_RULE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, COLOR_RULE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return [table]


def _header_row(headers: tuple[str, ...]) -> list[Flowable]:
    style = table_header_style()
    return [Paragraph(escape(h), style) for h in headers]


def _row(row: RenderTaxRow, *, is_intra: bool) -> list[Flowable]:
    left = table_cell_style(TA_LEFT)
    center = table_cell_style(TA_CENTER)
    right = table_cell_style(TA_RIGHT)
    total = table_cell_bold_style(TA_RIGHT)

    if is_intra:
        return [
            Paragraph(escape(row.hsn_sac), left),
            Paragraph(escape(row.taxable_value), right),
            Paragraph(escape(row.cgst_rate), center),
            Paragraph(escape(row.cgst_amount), right),
            Paragraph(escape(row.sgst_rate), center),
            Paragraph(escape(row.sgst_amount), right),
            Paragraph(escape(row.total_tax), total),
        ]
    return [
        Paragraph(escape(row.hsn_sac), left),
        Paragraph(escape(row.taxable_value), right),
        Paragraph(escape(row.igst_rate), center),
        Paragraph(escape(row.igst_amount), right),
        Paragraph(escape(row.total_tax), total),
    ]


__all__ = ["build_tax_summary"]
