"""Bill-to / ship-to party sections (Task 33).

Renders two visually distinct blocks (PDF_LAYOUT section 9): "Bill To" and
"Ship To / Consignee". Both are always shown even when identical, because the
render DTO preserves them as distinct parties (design section 2). Long names
and addresses wrap via Paragraph flowables and are never clipped (Req 19.3).

Consumes only the render DTO (DECISIONS D-011).
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO, RenderParty
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    body_style,
    party_name_style,
    section_heading_style,
)


def build_parties(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the bill-to / ship-to flowables for ``dto``."""
    left = _party_block("Bill To", dto.bill_to)
    right = _party_block("Ship To / Consignee", dto.ship_to)

    table = Table([[left, right]], colWidths=["50%", "50%"])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("LEFTPADDING", (1, 0), (1, 0), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                # A light divider between the two party blocks.
                ("LINEAFTER", (0, 0), (0, 0), 0.5, COLOR_RULE),
                ("LINEBELOW", (0, 0), (-1, -1), 0.75, COLOR_RULE),
            ]
        )
    )
    return [table]


def _party_block(heading: str, party: RenderParty) -> list[Flowable]:
    flowables: list[Flowable] = [Paragraph(escape(heading), section_heading_style())]
    flowables.append(Paragraph(escape(party.name), party_name_style()))
    body = body_style()
    for line in party.address_lines:
        flowables.append(Paragraph(escape(line), body))
    if party.state:
        flowables.append(Paragraph(f"State: {escape(party.state)}", body))
    if party.gstin:
        flowables.append(Paragraph(f"GSTIN: {escape(party.gstin)}", body))
    return flowables


__all__ = ["build_parties"]
