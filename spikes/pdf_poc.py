"""ReportLab proof-of-concept: generate a minimal A4 invoice PDF.

This is an early spike (Task 28) to prove the ReportLab pipeline works and
produces an A4 document. It uses a hardcoded sample DTO and a deliberately
minimal layout — it is NOT the production invoice renderer (that is Phase 6,
Tasks 31-42). Its only job is to de-risk PDF generation early (Req 26.1).

Run directly to write a sample PDF::

    python -m spikes.pdf_poc            # writes spikes/out/sample_invoice.pdf

The generated file is used by ``tests/integration/test_pdf_poc.py`` to confirm
a valid, A4-sized PDF is produced.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


@dataclass(frozen=True)
class SampleLine:
    description: str
    hsn_sac: str
    qty: str
    unit: str
    rate: str
    amount: str


@dataclass(frozen=True)
class SampleInvoiceDTO:
    """A hardcoded stand-in for the future render DTO (spike only)."""

    company_name: str = "Suntech Enterprises"
    invoice_number: str = "SE/26-27/043"
    invoice_date: str = "11-May-2026"
    customer_name: str = "DI-TECH MOULDS"
    place_of_supply: str = "Maharashtra (27)"
    lines: tuple[SampleLine, ...] = field(
        default_factory=lambda: (
            SampleLine("Punch Gun Drilling", "998898", "16", "NOS", "767.50", "12,280.00"),
        )
    )
    taxable: str = "12,280.00"
    cgst: str = "1,105.20"
    sgst: str = "1,105.20"
    round_off: str = "-0.40"
    grand_total: str = "14,490.00"
    amount_in_words: str = "INR Fourteen Thousand Four Hundred Ninety Only"


def render_sample_pdf(dto: SampleInvoiceDTO, output_path: Path) -> Path:
    """Render ``dto`` to a minimal A4 PDF at ``output_path``; return the path."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output_path), pagesize=A4)
    width, height = A4

    y = height - 20 * mm

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, y, dto.company_name)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(width - 20 * mm, y, "TAX INVOICE")
    y -= 12 * mm

    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, f"Invoice No: {dto.invoice_number}")
    c.drawRightString(width - 20 * mm, y, f"Date: {dto.invoice_date}")
    y -= 6 * mm
    c.drawString(20 * mm, y, f"Bill To: {dto.customer_name}")
    c.drawRightString(width - 20 * mm, y, f"Place of Supply: {dto.place_of_supply}")
    y -= 12 * mm

    # Line-item header.
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, "Description")
    c.drawString(95 * mm, y, "HSN/SAC")
    c.drawString(120 * mm, y, "Qty")
    c.drawString(135 * mm, y, "Unit")
    c.drawRightString(170 * mm, y, "Rate")
    c.drawRightString(width - 20 * mm, y, "Amount")
    y -= 5 * mm
    c.line(20 * mm, y, width - 20 * mm, y)
    y -= 6 * mm

    c.setFont("Helvetica", 9)
    for line in dto.lines:
        c.drawString(20 * mm, y, line.description)
        c.drawString(95 * mm, y, line.hsn_sac)
        c.drawString(120 * mm, y, line.qty)
        c.drawString(135 * mm, y, line.unit)
        c.drawRightString(170 * mm, y, line.rate)
        c.drawRightString(width - 20 * mm, y, line.amount)
        y -= 6 * mm

    y -= 6 * mm
    for label, value in (
        ("Taxable", dto.taxable),
        ("CGST", dto.cgst),
        ("SGST", dto.sgst),
        ("Round Off", dto.round_off),
    ):
        c.drawRightString(170 * mm, y, label)
        c.drawRightString(width - 20 * mm, y, value)
        y -= 6 * mm

    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(170 * mm, y, "GRAND TOTAL")
    c.drawRightString(width - 20 * mm, y, dto.grand_total)
    y -= 10 * mm

    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, y, dto.amount_in_words)

    c.showPage()
    c.save()
    return output_path


def default_output_path() -> Path:
    return Path(__file__).parent / "out" / "sample_invoice.pdf"


def main() -> int:
    path = render_sample_pdf(SampleInvoiceDTO(), default_output_path())
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
