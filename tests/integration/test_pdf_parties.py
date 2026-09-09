"""Tests for the PDF party sections component (Task 33)."""

from __future__ import annotations

import io

from reportlab.platypus import Paragraph, SimpleDocTemplate

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderParty,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.components.parties import _party_block, build_parties
from invoice_generator.infrastructure.pdf.styles import MARGIN, PAGE_SIZE


def _dto(bill: RenderParty, ship: RenderParty) -> InvoiceRenderDTO:
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=True,
        company=RenderParty(name="Suntech"),
        bill_to=bill,
        ship_to=ship,
        references=(),
        lines=(),
        tax_summary=(),
        totals=RenderTotals("0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "", ""),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="",
    )


def _texts(flowables: list[object]) -> list[str]:
    return [f.text for f in flowables if isinstance(f, Paragraph)]


def _render(dto: InvoiceRenderDTO) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    doc.build(build_parties(dto))
    return buf.getvalue()


def test_bill_to_block_contains_details() -> None:
    party = RenderParty(
        name="DI-TECH MOULDS",
        address_lines=("Plot 9, MIDC",),
        gstin="27ABCDE1234F1Z5",
        state="Maharashtra (27)",
    )
    texts = _texts(_party_block("Bill To", party))
    joined = " ".join(texts)
    assert "Bill To" in joined
    assert "DI-TECH MOULDS" in joined
    assert "Plot 9, MIDC" in joined
    assert "GSTIN: 27ABCDE1234F1Z5" in joined
    assert "State: Maharashtra (27)" in joined


def test_ship_to_heading() -> None:
    texts = _texts(_party_block("Ship To / Consignee", RenderParty(name="X")))
    assert any("Ship To / Consignee" in t for t in texts)


def test_both_blocks_rendered_even_when_identical() -> None:
    same = RenderParty(name="Same Co", address_lines=("Same Rd",), state="Gujarat (24)")
    dto = _dto(same, same)
    flowables = build_parties(dto)
    assert len(flowables) == 1  # one two-column table containing both blocks
    data = _render(dto)
    assert data.startswith(b"%PDF-")
    assert data.rstrip().endswith(b"%%EOF")


def test_long_name_and_address_wrap_without_error() -> None:
    long_name = "BMSS STEEL INDUSTRIES PRIVATE LIMITED " * 5
    long_addr = "Plot number 123, very long industrial estate road, sector 45, near landmark " * 3
    party = RenderParty(name=long_name, address_lines=(long_addr,), state="Maharashtra (27)")
    dto = _dto(party, party)
    data = _render(dto)  # must not raise despite very long content (no clipping)
    assert data.startswith(b"%PDF-")


def test_special_characters_escaped() -> None:
    party = RenderParty(name="A & B <Traders>", address_lines=("R&D Rd",))
    texts = _texts(_party_block("Bill To", party))
    assert any("A &amp; B &lt;Traders&gt;" in t for t in texts)


def test_empty_optional_fields_omitted() -> None:
    party = RenderParty(name="Minimal")  # no address/state/gstin
    texts = _texts(_party_block("Bill To", party))
    assert not any(t.startswith("GSTIN:") for t in texts)
    assert not any(t.startswith("State:") for t in texts)
