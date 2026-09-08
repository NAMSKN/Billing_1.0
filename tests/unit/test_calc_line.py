"""Unit tests for per-line calculation (gross/discount/taxable).

All assertions use exact Decimal equality (testing rules). Representative
values are used; they are not claimed to be the exact source line-level values
of the golden invoices (OPEN_QUESTIONS Q-013).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from invoice_generator.domain.calculation import LineAmounts, calculate_line


def test_simple_line_no_discount() -> None:
    result = calculate_line(Decimal("16"), Decimal("767.50"))
    assert result == LineAmounts(
        gross=Decimal("12280.00"),
        discount=Decimal("0.00"),
        taxable=Decimal("12280.00"),
    )


def test_default_discount_is_zero() -> None:
    result = calculate_line(Decimal("2"), Decimal("50.00"))
    assert result.discount == Decimal("0.00")
    assert result.taxable == Decimal("100.00")


def test_fractional_quantity() -> None:
    result = calculate_line(Decimal("2.5"), Decimal("100.00"), Decimal("10"))
    assert result.gross == Decimal("250.00")
    assert result.discount == Decimal("25.00")
    assert result.taxable == Decimal("225.00")


def test_percentage_discount_applied_before_tax() -> None:
    result = calculate_line(Decimal("1"), Decimal("100.00"), Decimal("15"))
    assert result.gross == Decimal("100.00")
    assert result.discount == Decimal("15.00")
    assert result.taxable == Decimal("85.00")


def test_gross_quantized_half_up() -> None:
    # 3 * 33.333 = 99.999 -> quantized to 100.00
    result = calculate_line(Decimal("3"), Decimal("33.333"))
    assert result.gross == Decimal("100.00")


def test_discount_quantized_half_up() -> None:
    # gross 100.00, 33.33% -> 33.33 discount -> taxable 66.67
    result = calculate_line(Decimal("1"), Decimal("100.00"), Decimal("33.33"))
    assert result.discount == Decimal("33.33")
    assert result.taxable == Decimal("66.67")


def test_full_discount_yields_zero_taxable() -> None:
    result = calculate_line(Decimal("4"), Decimal("25.00"), Decimal("100"))
    assert result.gross == Decimal("100.00")
    assert result.discount == Decimal("100.00")
    assert result.taxable == Decimal("0.00")


def test_zero_rate_line() -> None:
    result = calculate_line(Decimal("5"), Decimal("0"))
    assert result == LineAmounts(Decimal("0.00"), Decimal("0.00"), Decimal("0.00"))


@pytest.mark.parametrize(
    ("qty", "rate", "disc", "gross", "discount", "taxable"),
    [
        (Decimal("1"), Decimal("999.99"), Decimal("0"), "999.99", "0.00", "999.99"),
        (Decimal("10"), Decimal("12.50"), Decimal("5"), "125.00", "6.25", "118.75"),
        (Decimal("0.5"), Decimal("200.00"), Decimal("0"), "100.00", "0.00", "100.00"),
    ],
)
def test_representative_cases(
    qty: Decimal,
    rate: Decimal,
    disc: Decimal,
    gross: str,
    discount: str,
    taxable: str,
) -> None:
    result = calculate_line(qty, rate, disc)
    assert result.gross == Decimal(gross)
    assert result.discount == Decimal(discount)
    assert result.taxable == Decimal(taxable)


def test_all_amounts_have_two_decimal_places() -> None:
    result = calculate_line(Decimal("3"), Decimal("33.333"), Decimal("7"))
    for value in (result.gross, result.discount, result.taxable):
        assert value.as_tuple().exponent == -2


def test_result_is_immutable() -> None:
    result = calculate_line(Decimal("1"), Decimal("10.00"))
    with pytest.raises(AttributeError):
        result.gross = Decimal("0")  # type: ignore[misc]
