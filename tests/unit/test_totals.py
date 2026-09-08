"""Unit tests for invoice totals and explicit round-off."""

from __future__ import annotations

from decimal import Decimal

from invoice_generator.domain.calculation import TaxLineInput, calculate_invoice_totals
from invoice_generator.domain.enums import TaxTreatment, TaxType


def _intra(taxable: str, cgst: str, sgst: str) -> TaxLineInput:
    return TaxLineInput(
        hsn_sac="998898",
        tax_treatment=TaxTreatment.TAXABLE,
        tax_type=TaxType.INTRA_STATE,
        tax_rate=Decimal("18"),
        taxable=Decimal(taxable),
        cgst=Decimal(cgst),
        sgst=Decimal(sgst),
        igst=Decimal("0.00"),
    )


def test_negative_round_off_golden_043() -> None:
    totals = calculate_invoice_totals([_intra("12280.00", "1105.20", "1105.20")])
    assert totals.total_taxable == Decimal("12280.00")
    assert totals.total_cgst == Decimal("1105.20")
    assert totals.total_sgst == Decimal("1105.20")
    assert totals.total_igst == Decimal("0.00")
    assert totals.raw_total == Decimal("14490.40")
    assert totals.round_off == Decimal("-0.40")
    assert totals.grand_total == Decimal("14490.00")


def test_positive_round_off_golden_089() -> None:
    totals = calculate_invoice_totals([_intra("8332.00", "749.88", "749.88")])
    assert totals.raw_total == Decimal("9831.76")
    assert totals.round_off == Decimal("0.24")
    assert totals.grand_total == Decimal("9832.00")


def test_grand_total_equals_raw_plus_round_off() -> None:
    totals = calculate_invoice_totals([_intra("8332.00", "749.88", "749.88")])
    assert totals.grand_total == totals.raw_total + totals.round_off


def test_half_up_round_off() -> None:
    # raw 100.50 -> rounds up to 101.00 -> round_off +0.50
    totals = calculate_invoice_totals([_intra("100.50", "0.00", "0.00")])
    assert totals.raw_total == Decimal("100.50")
    assert totals.round_off == Decimal("0.50")
    assert totals.grand_total == Decimal("101.00")


def test_multiple_lines_sum_before_rounding() -> None:
    totals = calculate_invoice_totals(
        [
            _intra("5000.00", "450.00", "450.00"),
            _intra("7280.00", "655.20", "655.20"),
        ]
    )
    assert totals.total_taxable == Decimal("12280.00")
    assert totals.raw_total == Decimal("14490.40")
    assert totals.round_off == Decimal("-0.40")
    assert totals.grand_total == Decimal("14490.00")


def test_inter_state_totals() -> None:
    inter = TaxLineInput(
        hsn_sac="998898",
        tax_treatment=TaxTreatment.TAXABLE,
        tax_type=TaxType.INTER_STATE,
        tax_rate=Decimal("18"),
        taxable=Decimal("12280.00"),
        cgst=Decimal("0.00"),
        sgst=Decimal("0.00"),
        igst=Decimal("2210.40"),
    )
    totals = calculate_invoice_totals([inter])
    assert totals.total_igst == Decimal("2210.40")
    assert totals.raw_total == Decimal("14490.40")
    assert totals.round_off == Decimal("-0.40")
    assert totals.grand_total == Decimal("14490.00")


def test_empty_invoice_totals_are_zero() -> None:
    totals = calculate_invoice_totals([])
    assert totals.raw_total == Decimal("0.00")
    assert totals.round_off == Decimal("0.00")
    assert totals.grand_total == Decimal("0.00")


def test_totals_are_two_decimal_places() -> None:
    totals = calculate_invoice_totals([_intra("8332.00", "749.88", "749.88")])
    for value in (
        totals.total_taxable,
        totals.total_cgst,
        totals.total_sgst,
        totals.total_igst,
        totals.raw_total,
        totals.round_off,
        totals.grand_total,
    ):
        assert value.as_tuple().exponent == -2
