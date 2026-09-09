"""Immutable render view model for the PDF renderer.

The renderer consumes ONLY this DTO (DECISIONS D-011): it never queries the
database, resolves asset IDs, loads mutable settings, or recalculates values.
The DTO carries preformatted display strings, already-calculated amounts, the
tax summary, party blocks, the non-empty reference pairs (empty optionals are
omitted, Req 19.6), resolved asset references (path + version for the pinned
assets), the template version, and page metadata.

Money is formatted here (Indian digit grouping, 2 dp) so the renderer draws
strings verbatim.

References: requirements Req 19.6, 19.8; DECISIONS D-011, D-020; design sections
11, 17.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal


def format_money(amount: Decimal) -> str:
    """Format a rupee amount with Indian digit grouping and 2 dp.

    Examples: ``Decimal("12280.00")`` -> ``"12,280.00"``;
    ``Decimal("150000.00")`` -> ``"1,50,000.00"``; negatives keep the sign
    (``Decimal("-0.40")`` -> ``"-0.40"``).
    """
    quantized = amount.quantize(Decimal("0.01"))
    negative = quantized < 0
    whole, _, frac = f"{abs(quantized):.2f}".partition(".")
    grouped = _group_indian(whole)
    result = f"{grouped}.{frac}"
    return f"-{result}" if negative else result


def _group_indian(digits: str) -> str:
    """Group an integer digit string in the Indian system (last 3, then 2s)."""
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    # Group the head in pairs from the right.
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    parts.insert(0, head)
    return ",".join(parts) + "," + tail


def format_quantity(quantity: Decimal) -> str:
    """Format a quantity, trimming trailing zeros (e.g. 16, 2.5)."""
    normalized = quantity.normalize()
    text = f"{normalized:f}"
    return text


@dataclass(frozen=True)
class RenderReference:
    """A single populated reference/logistics field (label + value)."""

    label: str
    value: str


@dataclass(frozen=True)
class RenderParty:
    """A party block (company or bill-to/ship-to) as display lines."""

    name: str
    address_lines: tuple[str, ...] = ()
    gstin: str = ""
    state: str = ""


@dataclass(frozen=True)
class RenderLine:
    """A line-item row with preformatted display fields."""

    serial: int
    job_or_mould: str
    operation: str
    description: str
    specification: str
    hsn_sac: str
    quantity: str
    unit: str
    rate: str
    discount_percent: str
    amount: str


@dataclass(frozen=True)
class RenderTaxRow:
    """A tax-summary row with preformatted amounts."""

    hsn_sac: str
    taxable_value: str
    cgst_rate: str
    cgst_amount: str
    sgst_rate: str
    sgst_amount: str
    igst_rate: str
    igst_amount: str
    total_tax: str


@dataclass(frozen=True)
class RenderTotals:
    """Totals block, preformatted."""

    taxable: str
    cgst: str
    sgst: str
    igst: str
    round_off: str
    grand_total: str
    grand_total_words: str
    tax_amount_words: str


@dataclass(frozen=True)
class RenderAssetRef:
    """A resolved reference to a pinned asset (never an ID to resolve later)."""

    stored_path: str
    version: int


@dataclass(frozen=True)
class InvoiceRenderDTO:
    """Everything the ReportLab renderer needs to draw one invoice."""

    invoice_number: str
    invoice_date: str
    due_date: str
    place_of_supply: str
    payment_terms: str
    is_intra_state: bool
    company: RenderParty
    bill_to: RenderParty
    ship_to: RenderParty
    references: tuple[RenderReference, ...]
    lines: tuple[RenderLine, ...]
    tax_summary: tuple[RenderTaxRow, ...]
    totals: RenderTotals
    notes: str
    terms: str
    declaration: str
    authorized_signatory: str
    bank_details: tuple[RenderReference, ...] = field(default_factory=tuple)
    upi_id: str = ""
    logo: RenderAssetRef | None = None
    signature: RenderAssetRef | None = None
    template_version: int = 1
    cancelled: bool = False
