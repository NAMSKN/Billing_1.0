"""Totals block + amounts in words (Task 37).

Renders the right-aligned totals (Taxable, applicable tax components, Round Off)
and a strongly emphasized GRAND TOTAL, plus the amount-in-words and tax-amount-
in-words lines (PDF_LAYOUT sections 18-19; Req 19.7, 22). The grand total is the
largest, boldest monetary value with a highlighted box so it is the most
prominent figure on the page.

Only the tax components applicable to the invoice's mode are shown (CGST/SGST
for intra-state, IGST for inter-state) to avoid noisy zero rows. Consumes only
the render DTO (DECISIONS D-011).
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Paragraph, Spacer, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    COLOR_TOTAL_BG,
    grand_total_style,
    totals_label_style,
    totals_value_style,
    words_style,
)


def build_totals(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the totals + amount-in-words flowables for ``dto``."""
    totals = dto.totals

    rows: list[tuple[str, str, bool]] = [("Taxable Amount", totals.taxable, False)]
    if dto.is_intra_state:
        rows.append(("CGST", totals.cgst, False))
        rows.append(("SGST", totals.sgst, False))
    else:
        rows.append(("IGST", totals.igst, False))
    rows.append(("Round Off", totals.round_off, False))
    rows.append(("GRAND TOTAL", totals.grand_total, True))

    totals_table = _totals_table(rows)
    flowables: list[Flowable] = [totals_table, Spacer(1, 4 * mm)]
    flowables.extend(_words_block(dto))
    return flowables


def _totals_table(rows: list[tuple[str, str, bool]]) -> Table:
    label_style = totals_label_style()
    value_style = totals_value_style()
    grand_style = grand_total_style()

    table_rows: list[list[Flowable]] = []
    grand_index = -1
    for i, (label, value, is_grand) in enumerate(rows):
        if is_grand:
            grand_index = i
            table_rows.append(
                [Paragraph(escape(label), grand_style), Paragraph(escape(value), grand_style)]
            )
        else:
            table_rows.append(
                [Paragraph(escape(label), label_style), Paragraph(escape(value), value_style)]
            )

    # Right-align the block by using a wide left spacer column.
    table = Table(table_rows, colWidths=["70%", "30%"], hAlign="RIGHT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEABOVE", (0, len(table_rows) - 1), (-1, len(table_rows) - 1), 0.75, COLOR_RULE),
    ]
    if grand_index >= 0:
        # Highlight + box the grand-total row so it stands out (Req 19.7).
        style.append(("BACKGROUND", (0, grand_index), (-1, grand_index), COLOR_TOTAL_BG))
        style.append(("BOX", (0, grand_index), (-1, grand_index), 1.0, COLOR_RULE))
        style.append(("TOPPADDING", (0, grand_index), (-1, grand_index), 5))
        style.append(("BOTTOMPADDING", (0, grand_index), (-1, grand_index), 5))
    table.setStyle(TableStyle(style))
    return table


def _words_block(dto: InvoiceRenderDTO) -> list[Flowable]:
    style = words_style()
    flowables: list[Flowable] = []
    if dto.totals.grand_total_words:
        flowables.append(
            Paragraph(
                f"<b>Amount in Words:</b> {escape(dto.totals.grand_total_words)}", style
            )
        )
    if dto.totals.tax_amount_words:
        flowables.append(
            Paragraph(
                f"<b>Tax Amount in Words:</b> {escape(dto.totals.tax_amount_words)}", style
            )
        )
    return flowables


__all__ = ["build_totals"]
