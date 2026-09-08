"""Exact numeric representations for money, quantity, and percentages.

All domain arithmetic uses :class:`~decimal.Decimal`; binary floating point is
never used for money (DECISIONS D-004, coding standards). Values are persisted
losslessly as scaled integers, and conversion happens **only** at the
repository boundary (design section 3):

======================  ==================  ====================  =====
Value                   Domain type          Storage               Scale
======================  ==================  ====================  =====
Money (amounts, rate)   ``Decimal``          INTEGER paise         2 dp
Quantity                ``Decimal``          INTEGER millis        3 dp
Discount % / Tax %      ``Decimal``          INTEGER hundredths    2 dp
======================  ==================  ====================  =====

Conversion of a ``Decimal`` to its scaled integer quantizes to the fixed scale
using ``ROUND_HALF_UP`` (the project's single rounding mode, DECISIONS D-006).
Converting back is exact. A value already at (or within) its scale round-trips
losslessly.

This module is pure: no I/O, no clock, no global state. The calculation engine
(later task) owns *where* quantization happens during calculations; this module
only provides the exact storage conversions and helpers.

References: requirements Req 5; DECISIONS D-004, D-005, D-006; design section 3.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# Scale exponents used for quantization (number of decimal places).
MONEY_SCALE = 2
QUANTITY_SCALE = 3
PERCENT_SCALE = 2

# Multipliers from a scaled integer back to the decimal value.
_MONEY_FACTOR = 10**MONEY_SCALE  # paise per rupee
_QUANTITY_FACTOR = 10**QUANTITY_SCALE  # millis per unit
_PERCENT_FACTOR = 10**PERCENT_SCALE  # hundredths per percent

# Quantization targets (e.g. Decimal("0.01") for money).
_MONEY_QUANTUM = Decimal(1).scaleb(-MONEY_SCALE)
_QUANTITY_QUANTUM = Decimal(1).scaleb(-QUANTITY_SCALE)
_PERCENT_QUANTUM = Decimal(1).scaleb(-PERCENT_SCALE)


def _reject_float(value: object) -> None:
    """Guard against binary floating point entering a money/numeric path.

    Passing a ``float`` is a programming error: it may already carry binary
    rounding error before we ever quantize. Callers must pass ``Decimal``,
    ``int``, or ``str``.
    """
    if isinstance(value, float):
        raise TypeError(
            "float is not allowed for exact numeric values; pass Decimal, int, or str"
        )


def _to_decimal(value: Decimal | int | str) -> Decimal:
    """Coerce an accepted input type to ``Decimal`` (floats rejected)."""
    _reject_float(value)
    if isinstance(value, Decimal):
        return value
    return Decimal(value)


def quantize_money(value: Decimal | int | str) -> Decimal:
    """Return ``value`` quantized to 2 dp using ROUND_HALF_UP."""
    return _to_decimal(value).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def quantize_quantity(value: Decimal | int | str) -> Decimal:
    """Return ``value`` quantized to 3 dp using ROUND_HALF_UP."""
    return _to_decimal(value).quantize(_QUANTITY_QUANTUM, rounding=ROUND_HALF_UP)


def quantize_percent(value: Decimal | int | str) -> Decimal:
    """Return ``value`` quantized to 2 dp using ROUND_HALF_UP."""
    return _to_decimal(value).quantize(_PERCENT_QUANTUM, rounding=ROUND_HALF_UP)


def to_paise(value: Decimal | int | str) -> int:
    """Convert a monetary ``Decimal`` to integer paise (2 dp, ROUND_HALF_UP)."""
    return int(quantize_money(value) * _MONEY_FACTOR)


def from_paise(paise: int) -> Decimal:
    """Convert integer paise back to a 2-dp monetary ``Decimal`` (exact)."""
    if not isinstance(paise, int) or isinstance(paise, bool):
        raise TypeError("paise must be an int")
    result: Decimal = Decimal(paise) / _MONEY_FACTOR
    return result.quantize(_MONEY_QUANTUM)


def to_millis(value: Decimal | int | str) -> int:
    """Convert a quantity ``Decimal`` to integer millis (3 dp, ROUND_HALF_UP)."""
    return int(quantize_quantity(value) * _QUANTITY_FACTOR)


def from_millis(millis: int) -> Decimal:
    """Convert integer millis back to a 3-dp quantity ``Decimal`` (exact)."""
    if not isinstance(millis, int) or isinstance(millis, bool):
        raise TypeError("millis must be an int")
    result: Decimal = Decimal(millis) / _QUANTITY_FACTOR
    return result.quantize(_QUANTITY_QUANTUM)


def to_hundredths(value: Decimal | int | str) -> int:
    """Convert a percent ``Decimal`` to integer hundredths (2 dp, ROUND_HALF_UP).

    Example: ``Decimal("18.00")`` -> ``1800``.
    """
    return int(quantize_percent(value) * _PERCENT_FACTOR)


def from_hundredths(hundredths: int) -> Decimal:
    """Convert integer hundredths back to a 2-dp percent ``Decimal`` (exact)."""
    if not isinstance(hundredths, int) or isinstance(hundredths, bool):
        raise TypeError("hundredths must be an int")
    result: Decimal = Decimal(hundredths) / _PERCENT_FACTOR
    return result.quantize(_PERCENT_QUANTUM)
