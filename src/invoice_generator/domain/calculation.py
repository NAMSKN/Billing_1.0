"""Calculation engine (pure functions).

This module is the single authoritative source of invoice arithmetic
(DECISIONS D-006). No other layer recalculates money. All values are
:class:`~decimal.Decimal`; monetary results are quantized to 2 dp using
``ROUND_HALF_UP`` at the points defined here (via
:mod:`invoice_generator.domain.money`).

Task 7 implements per-line gross/discount/taxable amounts (design section 5):

    gross    = quantize(quantity * rate)
    discount = quantize(gross * discount_percent / 100)
    taxable  = quantize(gross - discount)

Task 8 adds tax determination: the tax type (intra- vs inter-state) is derived
from the company state versus the explicit Place of Supply (design section 4,
DECISIONS D-009), and only ``TaxTreatment.TAXABLE`` is supported in V1
(DECISIONS D-008) — unsupported treatments raise rather than being silently
taxed at 0%.

Per-line tax (Task 9), tax grouping (Task 10), and totals/round-off (Task 11)
extend this module in later tasks.

Functions are pure: no I/O, no clock, no global state.

References: requirements Req 6, 7.1, 11; DECISIONS D-004, D-006, D-008, D-009;
design sections 4, 5.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from invoice_generator.domain.enums import TaxTreatment, TaxType
from invoice_generator.domain.money import quantize_money

_HUNDRED = Decimal(100)


@dataclass(frozen=True)
class LineAmounts:
    """Calculated monetary amounts for a single line, each quantized to 2 dp."""

    gross: Decimal
    discount: Decimal
    taxable: Decimal


def calculate_line(
    quantity: Decimal,
    rate: Decimal,
    discount_percent: Decimal = Decimal(0),
) -> LineAmounts:
    """Compute gross, discount, and taxable amounts for one line.

    Args:
        quantity: Line quantity (``Decimal``; may be fractional).
        rate: Money per unit (``Decimal``).
        discount_percent: Discount percentage in ``[0, 100]`` (``Decimal``).

    Returns:
        :class:`LineAmounts` with each value quantized to 2 dp (ROUND_HALF_UP).

    The quantization points match design section 5: gross is quantized before
    the discount is applied, the discount is quantized, and taxable is the
    quantized difference. This keeps line results reproducible and lets the
    invoice-level aggregation sum exact 2-dp values.
    """
    gross = quantize_money(quantity * rate)
    discount = quantize_money(gross * discount_percent / _HUNDRED)
    taxable = quantize_money(gross - discount)
    return LineAmounts(gross=gross, discount=discount, taxable=taxable)


class UnsupportedTaxTreatmentError(ValueError):
    """Raised when a GST treatment outside the V1 scope is requested.

    V1 supports only :attr:`~invoice_generator.domain.enums.TaxTreatment.TAXABLE`
    (DECISIONS D-007/D-008). Reverse charge, exempt, nil-rated, zero-rated,
    export, and SEZ are explicitly out of scope and MUST NOT be silently taxed
    at 0%.
    """


def ensure_supported_treatment(treatment: TaxTreatment) -> None:
    """Raise :class:`UnsupportedTaxTreatmentError` unless ``treatment`` is TAXABLE."""
    if treatment is not TaxTreatment.TAXABLE:
        raise UnsupportedTaxTreatmentError(
            f"tax treatment {treatment.value!r} is not supported in V1"
        )


def determine_tax_type(
    company_state_code: str,
    place_of_supply_state_code: str,
) -> TaxType:
    """Return the tax type from company state vs the explicit Place of Supply.

    Intra-state (same state) → ``INTRA_STATE`` (CGST + SGST); different state →
    ``INTER_STATE`` (IGST). Place of Supply is the authoritative input
    (DECISIONS D-009); this determination happens in the engine, never in the
    UI (design section 4). State codes are compared after trimming surrounding
    whitespace.
    """
    company = company_state_code.strip()
    place = place_of_supply_state_code.strip()
    if company == place:
        return TaxType.INTRA_STATE
    return TaxType.INTER_STATE
