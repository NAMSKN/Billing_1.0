"""Unit tests for INR amount-to-words."""

from __future__ import annotations

from decimal import Decimal

import pytest

from invoice_generator.domain.amount_words import amount_in_words


def test_whole_amount_matches_req22_example() -> None:
    assert amount_in_words(Decimal("14490.00")) == "INR Fourteen Thousand Four Hundred Ninety Only"


def test_tax_amount_with_paise_matches_req22_example() -> None:
    assert (
        amount_in_words(Decimal("2210.40"))
        == "INR Two Thousand Two Hundred Ten and Forty Paise Only"
    )


def test_golden_089_grand_total() -> None:
    assert amount_in_words(Decimal("9832.00")) == "INR Nine Thousand Eight Hundred Thirty-Two Only"


def test_zero() -> None:
    assert amount_in_words(Decimal("0.00")) == "INR Zero Only"


def test_only_paise() -> None:
    assert amount_in_words(Decimal("0.40")) == "INR Zero and Forty Paise Only"


def test_single_rupee() -> None:
    assert amount_in_words(Decimal("1.00")) == "INR One Only"


def test_lakh_scale_indian_numbering() -> None:
    # en_IN uses lakh; 150000 -> One Lakh Fifty Thousand
    assert amount_in_words(Decimal("150000.00")) == "INR One Lakh Fifty Thousand Only"


def test_paise_rounding_half_up() -> None:
    # 10.005 -> 10.01 -> One Paise
    assert amount_in_words(Decimal("10.005")) == "INR Ten and One Paise Only"


def test_no_commas_or_lowercase_and_in_output() -> None:
    words = amount_in_words(Decimal("14490.00"))
    assert "," not in words
    assert " and " not in words  # no paise, so no 'and' separator either


def test_negative_amount_raises() -> None:
    with pytest.raises(ValueError):
        amount_in_words(Decimal("-1.00"))
