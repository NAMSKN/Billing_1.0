"""Header / branding + invoice metadata component (Task 32).

Builds the top block of the invoice (PDF_LAYOUT section 6): company branding on
the left (optional logo, name, address, GSTIN, state, phone/email) and the
"TAX INVOICE" title plus metadata on the right (invoice number, date, due date,
place of supply, payment terms). Empty metadata rows are omitted (Req 19.6) and
a missing/absent logo is omitted gracefully (Req 19.5).

Consumes only the render DTO (DECISIONS D-011). Returns Platypus flowables that
the renderer stacks; the full document assembly and pagination are Task 40.
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Image, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO, RenderParty
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    company_detail_style,
    company_name_style,
    invoice_title_style,
    metadata_style,
)

# Max logo footprint so branding never dominates the page (PDF_LAYOUT section 7).
_LOGO_MAX_W = 40 * mm
_LOGO_MAX_H = 20 * mm


def build_header(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the header flowables for ``dto``."""
    left = _company_column(dto.company, dto.logo.stored_path if dto.logo else None)
    right = _metadata_column(dto)

    table = Table([[left, right]], colWidths=["55%", "45%"])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, -1), 0.75, COLOR_RULE),
            ]
        )
    )
    return [table]


def _company_column(company: RenderParty, logo_path: str | None) -> list[Flowable]:
    flowables: list[Flowable] = []
    logo = _load_logo(logo_path)
    if logo is not None:
        flowables.append(logo)
    flowables.append(Paragraph(escape(company.name), company_name_style()))
    detail = company_detail_style()
    for line in company.address_lines:
        flowables.append(Paragraph(escape(line), detail))
    if company.state:
        flowables.append(Paragraph(f"State: {escape(company.state)}", detail))
    if company.gstin:
        flowables.append(Paragraph(f"GSTIN: {escape(company.gstin)}", detail))
    return flowables


def _metadata_column(dto: InvoiceRenderDTO) -> list[Flowable]:
    flowables: list[Flowable] = [Paragraph("TAX INVOICE", invoice_title_style())]
    style = metadata_style()
    rows = (
        ("Invoice No.", dto.invoice_number),
        ("Date", dto.invoice_date),
        ("Due Date", dto.due_date),
        ("Place of Supply", dto.place_of_supply),
        ("Payment Terms", dto.payment_terms),
    )
    for label, value in rows:
        if value:  # omit empty metadata rows (Req 19.6)
            flowables.append(Paragraph(f"{escape(label)}: {escape(value)}", style))
    return flowables


def _load_logo(logo_path: str | None) -> Image | None:
    """Return a sized logo Image, or None if absent/missing (Req 19.5)."""
    if not logo_path:
        return None
    if not Path(logo_path).is_file():
        return None
    try:
        image = Image(logo_path)
    except Exception:  # noqa: BLE001 - any image-load failure degrades gracefully
        return None
    _fit_within(image, _LOGO_MAX_W, _LOGO_MAX_H)
    return image


def _fit_within(image: Image, max_w: float, max_h: float) -> None:
    """Scale ``image`` to fit within the box, preserving aspect ratio."""
    width = float(image.drawWidth)
    height = float(image.drawHeight)
    if width <= 0 or height <= 0:
        return
    scale = min(max_w / width, max_h / height, 1.0)
    image.drawWidth = width * scale
    image.drawHeight = height * scale


__all__ = ["build_header"]
