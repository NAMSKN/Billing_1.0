"""Unit tests for exact numeric representations (money/quantity/percent).

Property-style coverage is provided by iterating over many deterministically
generated values with the standard library (no external property-testing
dependency, keeping the project offline and dependency-minimal). All money
assertions use exact Decimal/paise equality, never float tolerance.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from invoice_generator.domain.money import (
    from_hundredths,
    from_millis,
    from_paise,
    quantize_money,
    to_hundredths,
    to_millis,
    to_paise,
)

# --- Round-trip property tests (scaled integer -> Decimal -> scaled integer) ---


@pytest.mark.parametrize("paise", [0, 1, 99, 100, 1_105_20, -40, 1_449_000, -1])
def test_paise_round_trip_from_int(paise: int) -> None:
    assert to_paise(from_paise(paise)) == paise


@pytest.mark.parametrize("millis", [0, 1, 500, 1000, 16_000, 16_500, -1])
def test_millis_round_trip_from_int(millis: int) -> None:
    assert to_millis(from_millis(millis)) == millis


@pytest.mark.parametrize("hundredths", [0, 1, 900, 1800, 5000, 10000, -1])
def test_hundredths_round_trip_from_int(hundredths: int) -> None:
    assert to_hundredths(from_hundredths(hundredths)) == hundredths


def test_paise_round_trip_over_generated_range() -> None:
    # Deterministic sweep acting as a property test for Decimal<->paise.
    for cents in range(-250, 250):
        value = Decimal(cents) / 100
        assert from_paise(to_paise(value)) == value.quantize(Decimal("0.01"))


def test_quantity_round_trip_over_generated_range() -> None:
    for millis in range(0, 5000, 7):
        value = Decimal(millis) / 1000
        assert from_millis(to_millis(value)) == value.quantize(Decimal("0.001"))


def test_percent_round_trip_over_generated_range() -> None:
    for hundredths in range(0, 10001, 13):
        value = Decimal(hundredths) / 100
        assert from_hundredths(to_hundredths(value)) == value.quantize(Decimal("0.01"))


# --- Documented example ---


def test_percent_example_from_decisions() -> None:
    # DECISIONS D-005: 18.00% stored as 1800.
    assert to_hundredths(Decimal("18.00")) == 1800
    assert from_hundredths(1800) == Decimal("18.00")


# --- ROUND_HALF_UP behavior ---


def test_money_rounds_half_up() -> None:
    assert to_paise(Decimal("1.005")) == 101  # .005 rounds up to .01
    assert to_paise(Decimal("1.004")) == 100
    assert quantize_money(Decimal("2.345")) == Decimal("2.35")


def test_quantity_rounds_half_up() -> None:
    assert to_millis(Decimal("1.0005")) == 1001
    assert to_millis(Decimal("1.0004")) == 1000


def test_percent_rounds_half_up() -> None:
    assert to_hundredths(Decimal("9.005")) == 901
    assert to_hundredths(Decimal("9.004")) == 900


# --- Value inputs accepted from str/int ---


def test_accepts_str_and_int_inputs() -> None:
    assert to_paise("12.50") == 1250
    assert to_paise(5) == 500
    assert to_millis("16") == 16_000
    assert to_hundredths("0") == 0


# --- float rejection (no binary FP in money paths) ---


@pytest.mark.parametrize("fn", [to_paise, to_millis, to_hundredths, quantize_money])
def test_rejects_float_inputs(fn) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(TypeError):
        fn(1.23)


@pytest.mark.parametrize("fn", [from_paise, from_millis, from_hundredths])
def test_from_helpers_reject_non_int(fn) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(TypeError):
        fn(1.5)  # float
    with pytest.raises(TypeError):
        fn(True)  # bool is not an accepted int here


# --- exactness: no float ever appears ---


def test_conversions_return_exact_types() -> None:
    assert isinstance(to_paise(Decimal("1.00")), int)
    assert isinstance(from_paise(100), Decimal)
    assert from_paise(100) == Decimal("1.00")
