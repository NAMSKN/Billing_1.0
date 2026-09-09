"""Payment / bank details + optional UPI QR (Task 38).

Renders bank details and, when a UPI ID is configured, a UPI QR code
(PDF_LAYOUT section 20). The QR appears only when UPI data is present; when it
is not, nothing is drawn — no blank QR placeholder (Req 19.5). When there are
neither bank details nor a UPI ID, the whole section is omitted.

Consumes only the render DTO (DECISIONS D-011). The QR is generated from the
DTO's ``upi_id``; a generation failure degrades gracefully to no QR.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO
from invoice_generator.infrastructure.pdf.qr_renderer import make_qr_image, upi_qr_payload
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_RULE,
    body_style,
    section_heading_style,
)


def build_payment(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the payment/bank/QR flowables, or an empty list if none apply."""
    has_bank = bool(dto.bank_details)
    has_upi = bool(dto.upi_id)
    if not has_bank and not has_upi:
        return []  # nothing to show -> render nothing

    left = _bank_column(dto)
    right = _qr_column(dto)

    table = Table([[left, right]], colWidths=["70%", "30%"])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, COLOR_RULE),
            ]
        )
    )
    return [table]


def _bank_column(dto: InvoiceRenderDTO) -> list[Flowable]:
    flowables: list[Flowable] = []
    body = body_style()
    if dto.bank_details:
        flowables.append(Paragraph("Bank Details", section_heading_style()))
        for ref in dto.bank_details:
            flowables.append(Paragraph(f"<b>{escape(ref.label)}</b> {escape(ref.value)}", body))
    if dto.upi_id:
        flowables.append(Paragraph(f"<b>UPI ID:</b> {escape(dto.upi_id)}", body))
    return flowables


def _qr_column(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the QR image flowables when UPI is configured, else empty."""
    if not dto.upi_id:
        return []  # no UPI configured -> no QR, no placeholder (Req 19.5)
    try:
        qr = make_qr_image(upi_qr_payload(dto.upi_id))
    except Exception:  # noqa: BLE001 - QR generation failure degrades gracefully
        return []
    return [qr, Paragraph("Scan to pay (UPI)", body_style())]


__all__ = ["build_payment"]
