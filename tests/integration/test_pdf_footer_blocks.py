"""Tests for the PDF footer blocks component (Task 39)."""

from __future__ import annotations

import io
from pathlib import Path

from reportlab.platypus import Image, Paragraph, SimpleDocTemplate

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderAssetRef,
    RenderParty,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.footer_blocks import build_footer_blocks
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(**overrides: object) -> InvoiceRenderDTO:
    base: dict[str, object] = {
        "invoice_number": "SE/26-27/043",
        "invoice_date": "2026-05-11",
        "due_date": "",
        "place_of_supply": "Maharashtra (27)",
        "payment_terms": "",
        "is_intra_state": True,
        "company": RenderParty(name="Suntech Enterprises"),
        "bill_to": RenderParty(name="Cust"),
        "ship_to": RenderParty(name="Cust"),
        "references": (),
        "lines": (),
        "tax_summary": (),
        "totals": RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        "notes": "",
        "terms": "",
        "declaration": "",
        "authorized_signatory": "",
    }
    base.update(overrides)
    return InvoiceRenderDTO(**base)  # type: ignore[arg-type]


def _collect(flowables: list[object]) -> tuple[list[str], list[Image]]:
    texts = [f.text for f in flowables if isinstance(f, Paragraph)]
    images = [f for f in flowables if isinstance(f, Image)]
    return texts, images


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_footer_blocks(dto))
    return buf.getvalue()


def test_notes_rendered_when_present() -> None:
    texts, _ = _collect(build_footer_blocks(_dto(notes="Call before dispatch")))
    joined = " ".join(texts)
    assert "Notes" in joined
    assert "Call before dispatch" in joined


def test_notes_omitted_when_empty() -> None:
    texts, _ = _collect(build_footer_blocks(_dto(notes="")))
    assert not any(t == "Notes" for t in texts)


def test_terms_and_declaration_rendered() -> None:
    texts, _ = _collect(
        build_footer_blocks(
            _dto(terms="1. Payment in 30 days", declaration="We declare the particulars true.")
        )
    )
    joined = " ".join(texts)
    assert "Terms &amp; Conditions" in joined  # heading is XML-escaped
    assert "Payment in 30 days" in joined
    assert "Declaration" in joined
    assert "We declare the particulars true." in joined


def test_multiline_terms_preserved() -> None:
    texts, _ = _collect(build_footer_blocks(_dto(terms="1. First\n2. Second\n3. Third")))
    assert any("1. First<br/>2. Second<br/>3. Third" in t for t in texts)


def test_signature_block_always_present() -> None:
    texts, _ = _collect(build_footer_blocks(_dto()))
    assert any("Authorized Signatory" in t for t in texts)
    # Falls back to "For <company>" when no explicit signatory.
    assert any("For Suntech Enterprises" in t for t in texts)


def test_explicit_signatory_used() -> None:
    texts, _ = _collect(build_footer_blocks(_dto(authorized_signatory="For SUNTECH (Prop.)")))
    assert any("For SUNTECH (Prop.)" in t for t in texts)


def test_missing_signature_image_degrades_gracefully() -> None:
    dto = _dto(signature=RenderAssetRef(stored_path="/no/such/sig.png", version=1))
    _, images = _collect(build_footer_blocks(dto))
    assert images == []  # no image, but no crash
    # Still renders (reserved space + signatory text).
    data = _render(dto)
    assert data.startswith(b"%PDF-")


def test_signature_image_embedded_when_present(tmp_path: Path) -> None:
    from PIL import Image as PILImage

    sig = tmp_path / "sig.png"
    PILImage.new("RGB", (300, 120), "white").save(sig)
    dto = _dto(signature=RenderAssetRef(stored_path=str(sig), version=1))
    _, images = _collect(build_footer_blocks(dto))
    assert len(images) == 1


def test_special_characters_escaped() -> None:
    texts, _ = _collect(build_footer_blocks(_dto(notes="A & B <note>")))
    assert any("A &amp; B &lt;note&gt;" in t for t in texts)


def test_renders_to_valid_pdf() -> None:
    dto = _dto(notes="N", terms="T", declaration="D")
    data = _render(dto)
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")
