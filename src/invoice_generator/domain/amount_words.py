"""INR amount-to-words for invoice totals (Req 22).

Wraps :mod:`num2words` (Indian numbering: lakh/crore) and formats the result to
match the invoice style:

- Whole amount: ``INR Fourteen Thousand Four Hundred Ninety Only``
- With paise:   ``INR Two Thousand Two Hundred Ten and Forty Paise Only``

num2words produces lowercase text with commas and the connector "and"
(e.g. ``"fourteen thousand, four hundred and ninety"``). We normalize each part
by removing commas and the internal "and", collapsing whitespace, and applying
title case. The literal " and " between rupees and paise is added by this
module (it is a fixed separator, not num2words' connector).

Amounts are derived from final calculated :class:`~decimal.Decimal` values;
words are never entered manually (Req 22, DECISIONS D-006).

This module is pure: no I/O, no clock, no global state.

References: requirements Req 22; design sections 5, 18.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from num2words import num2words

_CURRENCY = "INR"
_LANG = "en_IN"
_PAISE_QUANTUM = Decimal("0.01")


def _words_for_integer(value: int) -> str:
    """Return title-cased words for a non-negative integer, no commas/'and'."""
    raw = num2words(value, lang=_LANG)
    # Remove commas, drop the standalone connector "and", collapse whitespace.
    no_commas = raw.replace(",", "")
    words = [w for w in no_commas.split() if w.lower() != "and"]
    return " ".join(words).title()


def _split_rupees_paise(amount: Decimal) -> tuple[int, int]:
    """Split a money ``Decimal`` into whole rupees and paise (0..99)."""
    quantized = amount.quantize(_PAISE_QUANTUM, rounding=ROUND_HALF_UP)
    if quantized < 0:
        raise ValueError("amount in words is not defined for negative amounts")
    rupees = int(quantized)
    paise = int((quantized - rupees) * 100)
    return rupees, paise


def amount_in_words(amount: Decimal) -> str:
    """Return the invoice-style words for a monetary amount.

    Examples:
        ``Decimal("14490.00")`` -> ``"INR Fourteen Thousand Four Hundred Ninety Only"``
        ``Decimal("2210.40")``  -> ``"INR Two Thousand Two Hundred Ten and Forty Paise Only"``
    """
    rupees, paise = _split_rupees_paise(amount)
    rupee_words = _words_for_integer(rupees)
    if paise == 0:
        return f"{_CURRENCY} {rupee_words} Only"
    paise_words = _words_for_integer(paise)
    return f"{_CURRENCY} {rupee_words} and {paise_words} Paise Only"
