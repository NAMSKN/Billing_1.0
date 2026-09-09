"""Tests for the PDF header/metadata component (Task 32)."""

from __future__ import annotations

import io
from pathlib import Path

from reportlab.platypus import Paragraph, SimpleDocTemplate

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderAssetRef,
    RenderParty,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.header import (
    _company_column,
    _load_logo,
    _metadata_column,
    build_header,
)
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(**overrides: object) -> InvoiceRenderDTO:
    base: dict[str, object] = {
        "invoice_number": "SE/26-27/043",
        "invoice_date": "2026-05-11",
        "due_date": "",
        "place_of_supply": "Maharashtra (27)",
        "payment_terms": "30 Days",
        "is_intra_state": True,
        "company": RenderParty(
            name="Suntech Enterprises",
            address_lines=("12 Industrial Rd",),
            gstin="27ABCDE1234F1Z5",
            state="Maharashtra (27)",
        ),
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


def _paragraph_texts(flowables: list[object]) -> list[str]:
    return [f.text for f in flowables if isinstance(f, Paragraph)]


def test_company_column_contains_required_text() -> None:
    texts = _paragraph_texts(_company_column(_dto().company, None))
    joined = " ".join(texts)
    assert "Suntech Enterprises" in joined
    assert "12 Industrial Rd" in joined
    assert "27ABCDE1234F1Z5" in joined
    assert "Maharashtra (27)" in joined


def test_metadata_column_contains_title_and_fields() -> None:
    texts = _paragraph_texts(_metadata_column(_dto()))
    joined = " ".join(texts)
    assert "TAX INVOICE" in joined
    assert "SE/26-27/043" in joined
    assert "2026-05-11" in joined
    assert "Place of Supply: Maharashtra (27)" in joined
    assert "Payment Terms: 30 Days" in joined


def test_metadata_omits_empty_due_date() -> None:
    texts = _paragraph_texts(_metadata_column(_dto(due_date="")))
    assert not any(t.startswith("Due Date:") for t in texts)


def test_metadata_includes_due_date_when_present() -> None:
    texts = _paragraph_texts(_metadata_column(_dto(due_date="2026-06-10")))
    assert any("Due Date: 2026-06-10" in t for t in texts)


def test_special_characters_escaped_not_crashing() -> None:
    company = RenderParty(name="A & B <Ltd>", address_lines=("R&D Rd",))
    texts = _paragraph_texts(_company_column(company, None))
    # Paragraph source text should be XML-escaped.
    assert any("A &amp; B &lt;Ltd&gt;" in t for t in texts)


def test_load_logo_none_when_missing() -> None:
    assert _load_logo(None) is None
    assert _load_logo("/no/such/file.png") is None


def test_build_header_renders_to_valid_pdf() -> None:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_header(_dto()))
    data = buf.getvalue()
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")


def test_build_header_with_missing_logo_still_renders() -> None:
    dto = _dto(logo=RenderAssetRef(stored_path="/no/such/logo.png", version=1))
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=PAGE_SIZE)
    doc.build(build_header(dto))  # must not raise despite missing logo file
    assert buf.getvalue().startswith(b"%PDF-")


def test_build_header_embeds_existing_logo(tmp_path: Path) -> None:
    # Create a tiny valid PNG via Pillow (a declared dependency).
    from PIL import Image as PILImage

    logo_path = tmp_path / "logo.png"
    PILImage.new("RGB", (200, 100), "white").save(logo_path)
    loaded = _load_logo(str(logo_path))
    assert loaded is not None
    # Scaled to fit within the max box, aspect preserved.
    assert loaded.drawWidth <= 40 * 2.83465 + 1  # ~40mm in pt
