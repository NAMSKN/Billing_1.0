"""Shared PDF styles: page geometry, fonts, colours, and paragraph styles.

Central definitions so all components (Tasks 32-41) render consistently and
remain readable in black-and-white (PDF_LAYOUT sections 14, 28, 29). Sizes
follow the layout guidance (compact but not sub-readable, Req 19.9).
"""

from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm

# Page geometry (A4 portrait with safe printable margins, PDF_LAYOUT section 4).
PAGE_SIZE = A4
MARGIN = 14 * mm

# Fonts.
FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"

# Colours (subtle; the document stays readable in grayscale).
COLOR_TEXT = colors.black
COLOR_MUTED = colors.HexColor("#444444")
COLOR_RULE = colors.HexColor("#999999")
COLOR_TOTAL_BG = colors.HexColor("#E8E8E8")  # subtle grand-total highlight (grayscale-safe)

# Minimum readable body size floor (Req 19.9); components must not go below it.
MIN_BODY_FONT_PT = 8.0


def company_name_style() -> ParagraphStyle:
    return ParagraphStyle(
        "CompanyName",
        fontName=FONT_BOLD,
        fontSize=15,
        leading=18,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
    )


def company_detail_style() -> ParagraphStyle:
    return ParagraphStyle(
        "CompanyDetail",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=12,
        textColor=COLOR_MUTED,
        alignment=TA_LEFT,
    )


def invoice_title_style() -> ParagraphStyle:
    return ParagraphStyle(
        "InvoiceTitle",
        fontName=FONT_BOLD,
        fontSize=16,
        leading=19,
        textColor=COLOR_TEXT,
        alignment=TA_RIGHT,
    )


def metadata_style() -> ParagraphStyle:
    return ParagraphStyle(
        "Metadata",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=13,
        textColor=COLOR_TEXT,
        alignment=TA_RIGHT,
    )


def section_heading_style() -> ParagraphStyle:
    return ParagraphStyle(
        "SectionHeading",
        fontName=FONT_BOLD,
        fontSize=9,
        leading=12,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
        spaceAfter=2,
    )


def party_name_style() -> ParagraphStyle:
    return ParagraphStyle(
        "PartyName",
        fontName=FONT_BOLD,
        fontSize=9.5,
        leading=12,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
    )


def body_style() -> ParagraphStyle:
    """General body text; wraps long content (Req 19.3), stays readable."""
    return ParagraphStyle(
        "Body",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=12,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
        wordWrap="CJK",  # break very long unbroken tokens instead of clipping
    )


def table_header_style() -> ParagraphStyle:
    return ParagraphStyle(
        "TableHeader",
        fontName=FONT_BOLD,
        fontSize=8.5,
        leading=10,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
    )


def table_cell_style(alignment: int = TA_LEFT) -> ParagraphStyle:
    """A compact, wrapping table-cell style (never below the readable floor)."""
    return ParagraphStyle(
        "TableCell",
        fontName=FONT_REGULAR,
        fontSize=8.5,
        leading=10.5,
        textColor=COLOR_TEXT,
        alignment=alignment,
        wordWrap="CJK",
    )


def table_cell_bold_style(alignment: int = TA_LEFT) -> ParagraphStyle:
    return ParagraphStyle(
        "TableCellBold",
        fontName=FONT_BOLD,
        fontSize=8.5,
        leading=10.5,
        textColor=COLOR_TEXT,
        alignment=alignment,
        wordWrap="CJK",
    )


def totals_label_style() -> ParagraphStyle:
    return ParagraphStyle(
        "TotalsLabel",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=13,
        textColor=COLOR_TEXT,
        alignment=TA_RIGHT,
    )


def totals_value_style() -> ParagraphStyle:
    return ParagraphStyle(
        "TotalsValue",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=13,
        textColor=COLOR_TEXT,
        alignment=TA_RIGHT,
    )


def grand_total_style() -> ParagraphStyle:
    """The most prominent monetary style on the page (Req 19.7)."""
    return ParagraphStyle(
        "GrandTotal",
        fontName=FONT_BOLD,
        fontSize=13,
        leading=16,
        textColor=COLOR_TEXT,
        alignment=TA_RIGHT,
    )


def words_style() -> ParagraphStyle:
    return ParagraphStyle(
        "Words",
        fontName=FONT_REGULAR,
        fontSize=9,
        leading=12,
        textColor=COLOR_TEXT,
        alignment=TA_LEFT,
        wordWrap="CJK",
    )
