"""Footer content: notes, terms, declaration, and signature (Task 39).

Renders the invoice footer blocks (PDF_LAYOUT sections 22-25): Notes and
Declaration in compact blocks, Terms & Conditions in a smaller readable font,
and a right-aligned signature area ("For <company>", optional signature/stamp
image, "Authorized Signatory"). Each text block is rendered only when it has
content; a missing or absent signature image degrades gracefully (Req 17.5,
19.5). All values come from the finalized snapshot via the render DTO
(DECISIONS D-011, Req 12.1).
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Image, Paragraph, Spacer

from invoice_generator.application.render_dto import InvoiceRenderDTO
from invoice_generator.infrastructure.pdf.styles import (
    body_style,
    legal_style,
    section_heading_style,
    signature_bold_style,
    signature_style,
)

_SIG_MAX_W = 45 * mm
_SIG_MAX_H = 22 * mm


def build_text_blocks(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the notes/terms/declaration flowables (these may flow/paginate)."""
    flowables: list[Flowable] = []
    flowables.extend(_text_block("Notes", dto.notes, body_style()))
    flowables.extend(_text_block("Terms & Conditions", dto.terms, legal_style()))
    flowables.extend(_text_block("Declaration", dto.declaration, legal_style()))
    return flowables


def build_signature_block(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the signature block flowables (kept together by the renderer)."""
    return _signature_block(dto)


def build_footer_blocks(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return all footer flowables (notes/terms/declaration then signature).

    Convenience for tests/simple callers. The renderer composes the pieces
    separately so only the signature block is kept together (Task 40).
    """
    return [*build_text_blocks(dto), *build_signature_block(dto)]


def _text_block(heading: str, content: str, content_style: ParagraphStyle) -> list[Flowable]:
    if not content.strip():
        return []  # omit empty blocks
    flowables: list[Flowable] = [Paragraph(escape(heading), section_heading_style())]
    # Preserve author line breaks by converting newlines to <br/>.
    body = "<br/>".join(escape(line) for line in content.splitlines()) or escape(content)
    flowables.append(Paragraph(body, content_style))
    flowables.append(Spacer(1, 3 * mm))
    return flowables


def _signature_block(dto: InvoiceRenderDTO) -> list[Flowable]:
    flowables: list[Flowable] = [Spacer(1, 4 * mm)]
    company_line = dto.authorized_signatory or f"For {dto.company.name}"
    flowables.append(Paragraph(escape(company_line), signature_bold_style()))

    signature_image = _load_signature(dto)
    if signature_image is not None:
        flowables.append(signature_image)
    else:
        flowables.append(Spacer(1, _SIG_MAX_H))  # reserve space for a physical sign/stamp

    flowables.append(Paragraph("Authorized Signatory", signature_style()))
    return flowables


def _load_signature(dto: InvoiceRenderDTO) -> Image | None:
    """Return a sized signature Image, or None if not configured/missing."""
    if dto.signature is None:
        return None
    path = dto.signature.stored_path
    if not path or not Path(path).is_file():
        return None
    try:
        image = Image(path)
    except Exception:  # noqa: BLE001 - any load failure degrades gracefully
        return None
    _fit_within(image, _SIG_MAX_W, _SIG_MAX_H)
    image.hAlign = "RIGHT"
    return image


def _fit_within(image: Image, max_w: float, max_h: float) -> None:
    width = float(image.drawWidth)
    height = float(image.drawHeight)
    if width <= 0 or height <= 0:
        return
    scale = min(max_w / width, max_h / height, 1.0)
    image.drawWidth = width * scale
    image.drawHeight = height * scale


__all__ = ["build_footer_blocks"]
