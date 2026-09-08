"""Unit tests for per-line tax calculation."""

from __future__ import annotations

from decimal import Decimal

from invoice_generator.domain.calculation import LineTax, calculate_line_tax
from invoice_generator.domain.enums import TaxType
from invoice_generator.domain.models import TaxRateConfig

STANDARD_18 = TaxRateConfig(
    total_rate=Decimal("18"),
    cgst_rate=Decimal("9"),
    sgst_rate=Decimal("9"),
    igst_rate=Decimal("18"),
)


def test_intra_state_splits_into_cgst_sgst() -> None:
    tax = calculate_line_tax(Decimal("12280.00"), TaxType.INTRA_STATE, STANDARD_18)
    assert tax.cgst == Decimal("1105.20")
    assert tax.sgst == Decimal("1105.20")
    assert tax.igst == Decimal("0.00")


def test_intra_state_second_golden_taxable() -> None:
    tax = calculate_line_tax(Decimal("8332.00"), TaxType.INTRA_STATE, STANDARD_18)
    assert tax.cgst == Decimal("749.88")
    assert tax.sgst == Decimal("749.88")
    assert tax.igst == Decimal("0.00")


def test_inter_state_uses_igst_only() -> None:
    tax = calculate_line_tax(Decimal("12280.00"), TaxType.INTER_STATE, STANDARD_18)
    assert tax.igst == Decimal("2210.40")
    assert tax.cgst == Decimal("0.00")
    assert tax.sgst == Decimal("0.00")


def test_never_both_component_sets_on_one_line() -> None:
    intra = calculate_line_tax(Decimal("1000.00"), TaxType.INTRA_STATE, STANDARD_18)
    assert intra.igst == Decimal("0.00")
    inter = calculate_line_tax(Decimal("1000.00"), TaxType.INTER_STATE, STANDARD_18)
    assert inter.cgst == Decimal("0.00") and inter.sgst == Decimal("0.00")


def test_uses_configured_components_not_half_of_total() -> None:
    # Asymmetric split: cgst 10% + sgst 8% = 18% total. If the engine wrongly
    # halved total_rate it would produce 9%/9%; it must use the config.
    asymmetric = TaxRateConfig(
        total_rate=Decimal("18"),
        cgst_rate=Decimal("10"),
        sgst_rate=Decimal("8"),
        igst_rate=Decimal("18"),
    )
    tax = calculate_line_tax(Decimal("1000.00"), TaxType.INTRA_STATE, asymmetric)
    assert tax.cgst == Decimal("100.00")  # 10%, not 9%
    assert tax.sgst == Decimal("80.00")  # 8%, not 9%


def test_amounts_quantized_half_up() -> None:
    # taxable 55.55 at 9% = 4.99950 -> 5.00 (half up)
    tax = calculate_line_tax(Decimal("55.55"), TaxType.INTRA_STATE, STANDARD_18)
    assert tax.cgst == Decimal("5.00")


def test_zero_taxable_yields_zero_tax() -> None:
    tax = calculate_line_tax(Decimal("0.00"), TaxType.INTRA_STATE, STANDARD_18)
    assert tax == LineTax(Decimal("0.00"), Decimal("0.00"), Decimal("0.00"))


def test_all_components_two_decimal_places() -> None:
    tax = calculate_line_tax(Decimal("123.45"), TaxType.INTER_STATE, STANDARD_18)
    for value in (tax.cgst, tax.sgst, tax.igst):
        assert value.as_tuple().exponent == -2
