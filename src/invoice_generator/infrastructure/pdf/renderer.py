"""Invoice PDF renderer: assemble components into a paginated A4 document.

Builds the full invoice story from the section components (Tasks 32-39) in the
required order (Req 19.2) and renders it with a ``BaseDocTemplate`` that:

- repeats the line-item table header on continued pages (the table itself uses
  ``repeatRows=1``);
- keeps the totals block (and signature) together so they are not split
  awkwardly across a page boundary (Req 19.3);
- draws a "Computer Generated Invoice" footer with "Page X of Y" on every page.

Consumes only the render DTO (DECISIONS D-011): no database access, no asset-ID
resolution, no recalculation. Section order and page geometry follow the design
(sections 18, 21-22) and PDF_LAYOUT.
"""

from __future__ import annotations

import io

from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageTemplate,
    Spacer,
)

from invoice_generator.application.render_dto import InvoiceRenderDTO
from invoice_generator.infrastructure.pdf.components.footer_blocks import (
    build_signature_block,
    build_text_blocks,
)
from invoice_generator.infrastructure.pdf.components.header import build_header
from invoice_generator.infrastructure.pdf.components.line_items import build_line_items
from invoice_generator.infrastructure.pdf.components.parties import build_parties
from invoice_generator.infrastructure.pdf.components.payment import build_payment
from invoice_generator.infrastructure.pdf.components.references import build_references
from invoice_generator.infrastructure.pdf.components.tax_summary import build_tax_summary
from invoice_generator.infrastructure.pdf.components.totals import build_totals
from invoice_generator.infrastructure.pdf.styles import (
    COLOR_MUTED,
    FONT_REGULAR,
    MARGIN,
    PAGE_SIZE,
)

_FOOTER_TEXT = "This is a Computer Generated Invoice"
_FOOTER_FONT_SIZE = 7
_SECTION_GAP = 4 * mm


class _NumberedCanvas(Canvas):  # type: ignore[misc]  # reportlab is untyped (Canvas is Any)
    """Canvas that writes 'Page X of Y' once the total page count is known.

    ReportLab renders pages before the total is known, so page states are
    buffered and the footer is drawn in a second pass on ``save`` (a standard
    ReportLab idiom).
    """

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self._saved_states: list[dict[str, object]] = []

    def showPage(self) -> None:  # noqa: N802 - ReportLab API name
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._saved_states)
        for state in self._saved_states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total_pages: int) -> None:
        left_text, right_text = page_footer_texts(self._pageNumber, total_pages)
        width, _ = PAGE_SIZE
        self.setFont(FONT_REGULAR, _FOOTER_FONT_SIZE)
        self.setFillColor(COLOR_MUTED)
        y = MARGIN * 0.5
        self.drawString(MARGIN, y, left_text)
        self.drawRightString(width - MARGIN, y, right_text)


def page_footer_texts(page: int, total_pages: int) -> tuple[str, str]:
    """Return the (left, right) footer strings for a page (pure, testable)."""
    return _FOOTER_TEXT, f"Page {page} of {total_pages}"


def build_story(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Assemble the ordered flowable story for ``dto`` (Req 19.2 order)."""
    story: list[Flowable] = []
    story.extend(build_header(dto))
    story.append(Spacer(1, _SECTION_GAP))
    story.extend(build_parties(dto))
    story.append(Spacer(1, _SECTION_GAP))
    story.extend(_with_gap(build_references(dto)))
    story.extend(build_line_items(dto))
    story.append(Spacer(1, _SECTION_GAP))
    story.extend(_with_gap(build_tax_summary(dto)))
    # Keep the totals + amount-in-words block together across page breaks.
    totals = build_totals(dto)
    if totals:
        story.append(KeepTogether(totals))
        story.append(Spacer(1, _SECTION_GAP))
    story.extend(_with_gap(build_payment(dto)))
    # Notes/terms/declaration flow normally (they may paginate for long text).
    story.extend(_with_gap(build_text_blocks(dto)))
    # Keep only the signature block together so its lines/image are not split.
    signature = build_signature_block(dto)
    if signature:
        story.append(KeepTogether(signature))
    return story


def _with_gap(flowables: list[Flowable]) -> list[Flowable]:
    """Append a section gap after a block, but only if the block is non-empty."""
    if not flowables:
        return []
    return [*flowables, Spacer(1, _SECTION_GAP)]


def render_invoice_pdf(dto: InvoiceRenderDTO) -> bytes:
    """Render ``dto`` to A4 PDF bytes with pagination and page numbers."""
    buffer = io.BytesIO()
    frame = Frame(
        MARGIN,
        MARGIN,
        PAGE_SIZE[0] - 2 * MARGIN,
        PAGE_SIZE[1] - 2 * MARGIN,
        id="body",
    )
    doc = BaseDocTemplate(
        buffer,
        pagesize=PAGE_SIZE,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=f"Invoice {dto.invoice_number}",
    )
    doc.addPageTemplates([PageTemplate(id="invoice", frames=[frame])])
    doc.build(build_story(dto), canvasmaker=_NumberedCanvas)
    return buffer.getvalue()


__all__ = ["build_story", "page_footer_texts", "render_invoice_pdf"]
