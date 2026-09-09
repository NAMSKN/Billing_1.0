"""Tests for long-content robustness in the invoice renderer (Task 41).

Verifies extreme content wraps and paginates rather than being clipped, and
that no component style falls below the readable-font floor (Req 19.3, 19.9).
"""

from __future__ import annotations

import re

from invoice_generator.application.render_dto import (
    InvoiceRenderDTO,
    RenderLine,
    RenderParty,
    RenderTaxRow,
    RenderTotals,
)
from invoice_generator.infrastructure.pdf.renderer import render_invoice_pdf
from invoice_generator.infrastructure.pdf.styles import (
    MIN_BODY_FONT_PT,
    all_component_styles,
    min_component_font_size,
)


def _line(
    serial: int, *, description: str = "Gundrilling", specification: str = "Spec"
) -> RenderLine:
    return RenderLine(
        serial=serial,
        job_or_mould="DT-663",
        operation="Punch Gun Drilling",
        description=description,
        specification=specification,
        hsn_sac="998898",
        quantity="16",
        unit="NOS",
        rate="767.50",
        discount_percent="0",
        amount="12,280.00",
    )


def _dto(lines: tuple[RenderLine, ...], *, company_name: str = "Suntech") -> InvoiceRenderDTO:
    return InvoiceRenderDTO(
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        due_date="",
        place_of_supply="Maharashtra (27)",
        payment_terms="",
        is_intra_state=True,
        company=RenderParty(name=company_name, state="Maharashtra (27)"),
        bill_to=RenderParty(name="Cust", state="Maharashtra (27)"),
        ship_to=RenderParty(name="Cust", state="Maharashtra (27)"),
        references=(),
        lines=lines,
        tax_summary=(
            RenderTaxRow(
                "998898", "12,280.00", "9", "1,105.20", "9", "1,105.20", "", "0.00", "2,210.40"
            ),
        ),
        totals=RenderTotals(
            "12,280.00", "1,105.20", "1,105.20", "0.00", "-0.40", "14,490.00",
            "INR Fourteen Thousand Four Hundred Ninety Only", "",
        ),
        notes="",
        terms="",
        declaration="",
        authorized_signatory="For Suntech",
    )


def _pages(pdf: bytes) -> int:
    return len(re.findall(rb"/MediaBox", pdf))


# --- readable-font floor (Req 19.9) ---


def test_no_style_below_font_floor() -> None:
    for style in all_component_styles():
        assert style.fontSize >= MIN_BODY_FONT_PT, f"{style.name} is below the readable floor"


def test_min_component_font_size_at_floor() -> None:
    assert min_component_font_size() >= MIN_BODY_FONT_PT
    assert min_component_font_size() == MIN_BODY_FONT_PT  # legal text sits at the floor


# --- long content wraps / paginates, not clipped (Req 19.3) ---


def test_very_long_description_renders() -> None:
    long_desc = "Extremely long machining description with many dimensions " * 40
    pdf = render_invoice_pdf(_dto((_line(1, description=long_desc),)))
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")


def test_long_specification_forces_pagination() -> None:
    long_spec = "Six side machining 510 x 430 x 130 mm with tight tolerances " * 80
    pdf = render_invoice_pdf(_dto((_line(1, specification=long_spec),)))
    # A single line whose specification is enormous must flow onto >1 page
    # rather than being clipped to fit one page.
    assert _pages(pdf) > 1


def test_long_company_name_renders() -> None:
    long_name = "SUNTECH ENTERPRISES PRECISION MOULD AND MACHINING WORKS " * 6
    pdf = render_invoice_pdf(_dto((_line(1),), company_name=long_name))
    assert pdf.startswith(b"%PDF-")


def test_content_grows_pages_not_clipped() -> None:
    small = render_invoice_pdf(_dto(tuple(_line(i) for i in range(1, 4))))
    big = render_invoice_pdf(_dto(tuple(_line(i) for i in range(1, 90))))
    # More line items => more pages (content preserved, not clipped onto one).
    assert _pages(big) > _pages(small)


def test_unbroken_token_wraps_without_crash() -> None:
    # A single very long unbroken token must be broken (wordWrap CJK), not clip.
    token = "X" * 400
    pdf = render_invoice_pdf(_dto((_line(1, specification=token),)))
    assert pdf.startswith(b"%PDF-")
