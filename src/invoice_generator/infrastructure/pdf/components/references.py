"""References / logistics grid (Task 34).

Renders a compact grid of invoice reference/logistics fields (PDF_LAYOUT
section 10): PO, challan, delivery note, dispatch, vehicle, destination, terms
of delivery, etc. Only populated values are rendered — empty fields produce no
label at all, avoiding blanks like ``PO No:`` with no value (Req 19.6, finding
3.17). When there are no populated references, the component renders nothing.

The render DTO already contains only the populated references (built by
``PdfService.build_dto``); this component only lays them out. Consumes only the
render DTO (DECISIONS D-011).
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from invoice_generator.application.render_dto import InvoiceRenderDTO, RenderReference
from invoice_generator.infrastructure.pdf.styles import COLOR_RULE, body_style

# Two label/value pairs per row keeps the grid compact (PDF_LAYOUT section 10).
_COLUMNS = 2


def build_references(dto: InvoiceRenderDTO) -> list[Flowable]:
    """Return the reference-grid flowables, or an empty list if none apply."""
    references = dto.references
    if not references:
        return []  # no populated references -> render nothing (no empty labels)

    cells = [_reference_cell(ref) for ref in references]
    rows = _to_grid(cells, _COLUMNS)

    table = Table(rows, colWidths=["50%", "50%"])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, 0), (-1, -1), 0.75, COLOR_RULE),
            ]
        )
    )
    return [table]


def _reference_cell(ref: RenderReference) -> Paragraph:
    return Paragraph(f"<b>{escape(ref.label)}</b> {escape(ref.value)}", body_style())


def _to_grid(cells: list[Paragraph], columns: int) -> list[list[Flowable]]:
    """Arrange ``cells`` into rows of ``columns``, padding the last row."""
    rows: list[list[Flowable]] = []
    for start in range(0, len(cells), columns):
        row: list[Flowable] = list(cells[start : start + columns])
        while len(row) < columns:
            row.append(Paragraph("", body_style()))  # empty filler cell
        rows.append(row)
    return rows


__all__ = ["build_references"]
