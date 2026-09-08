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

Tax determination (Task 8), per-line tax (Task 9), tax grouping (Task 10), and
totals/round-off (Task 11) extend this module in later tasks.

Functions are pure: no I/O, no clock, no global state.

References: requirements Req 7.1; DECISIONS D-004, D-006; design section 5.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

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
