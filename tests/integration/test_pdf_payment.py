"""Tests for the PDF payment / QR component (Task 38)."""

from __future__ import annotations

import io

from reportlab.platypus import Image, Paragraph, SimpleDocTemplate

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderParty,
    RenderReference,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.payment import build_payment
from invoice_generator.infrastructure.pdf.qr_renderer import make_qr_image, upi_qr_payload
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE

_BANK = (
    RenderReference("Bank Name", "HDFC"),
    RenderReference("A/C No.", "123456"),
    RenderReference("IFSC", "HDFC0001234"),
)


def _dto(*, bank: tuple[RenderReference, ...] = (), upi_id: str = "") -> InvoiceRenderDTO:
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=True,
        company=RenderParty(name="Suntech"),
        bill_to=RenderParty(name="Cust"),
        ship_to=RenderParty(name="Cust"),
        references=(),
        lines=(),
        tax_summary=(),
        totals=RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
        bank_details=bank,
        upi_id=upi_id,
    )


def _collect(flowables: list[object]) -> tuple[list[str], list[Image]]:
    """Return (paragraph texts, images) found anywhere in the flowables."""
    texts: list[str] = []
    images: list[Image] = []

    def visit(item: object) -> None:
        if isinstance(item, Paragraph):
            texts.append(item.text)
        elif isinstance(item, Image):
            images.append(item)
        elif hasattr(item, "_cellvalues"):
            for row in item._cellvalues:  # type: ignore[attr-defined]
                for cell in row:
                    if isinstance(cell, list):
                        for sub in cell:
                            visit(sub)
                    else:
                        visit(cell)

    for f in flowables:
        visit(f)
    return texts, images


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_payment(dto))
    return buf.getvalue()


def test_qr_payload_format() -> None:
    assert upi_qr_payload("test@bank") == "upi://pay?pa=test@bank"


def test_make_qr_image_returns_image() -> None:
    img = make_qr_image("upi://pay?pa=test@bank")
    assert isinstance(img, Image)


def test_no_bank_no_upi_renders_nothing() -> None:
    assert build_payment(_dto()) == []


def test_bank_details_render() -> None:
    texts, _ = _collect(build_payment(_dto(bank=_BANK)))
    joined = " ".join(texts)
    assert "Bank Details" in joined
    assert "HDFC" in joined
    assert "HDFC0001234" in joined


def test_qr_present_when_upi_configured() -> None:
    _, images = _collect(build_payment(_dto(bank=_BANK, upi_id="suntech@hdfc")))
    assert len(images) == 1  # UPI QR present


def test_qr_omitted_when_no_upi() -> None:
    texts, images = _collect(build_payment(_dto(bank=_BANK)))
    assert images == []  # no QR, no placeholder (Req 19.5)
    assert not any("Scan to pay" in t for t in texts)


def test_upi_only_still_renders_qr() -> None:
    _, images = _collect(build_payment(_dto(upi_id="suntech@hdfc")))
    assert len(images) == 1


def test_upi_id_shown_in_text() -> None:
    texts, _ = _collect(build_payment(_dto(upi_id="suntech@hdfc")))
    assert any("suntech@hdfc" in t for t in texts)


def test_renders_to_valid_pdf() -> None:
    data = _render(_dto(bank=_BANK, upi_id="suntech@hdfc"))
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")
