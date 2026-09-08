"""Golden regression tests: engine reproduces documented aggregate values.

These lock in the calculation engine against the two real source invoices
(Req 28). They are aggregate fixtures (Q-013): they verify taxable, CGST, SGST,
round-off, and grand total, not fabricated per-line detail.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from invoice_generator.domain.calculation import (
    TaxLineInput,
    calculate_invoice_totals,
    calculate_line_tax,
)
from invoice_generator.domain.enums import TaxTreatment, TaxType
from tests.fixtures.golden_invoices import (
    ALL_GOLDEN,
    GOLDEN_043,
    GOLDEN_089,
    LINE_LEVEL_SOURCE_AVAILABLE,
    AggregateGoldenInvoice,
)


@pytest.mark.parametrize("golden", ALL_GOLDEN, ids=lambda g: g.invoice_number)
def test_engine_reproduces_tax_components(golden: AggregateGoldenInvoice) -> None:
    tax = calculate_line_tax(golden.taxable, TaxType.INTRA_STATE, golden.tax_config)
    assert tax.cgst == golden.cgst
    assert tax.sgst == golden.sgst
    assert tax.igst.is_zero()


@pytest.mark.parametrize("golden", ALL_GOLDEN, ids=lambda g: g.invoice_number)
def test_engine_reproduces_totals_and_round_off(golden: AggregateGoldenInvoice) -> None:
    line = TaxLineInput(
        hsn_sac="998898",
        tax_treatment=TaxTreatment.TAXABLE,
        tax_type=TaxType.INTRA_STATE,
        tax_rate=golden.tax_config.total_rate,
        taxable=golden.taxable,
        cgst=golden.cgst,
        sgst=golden.sgst,
        igst=Decimal("0.00"),
    )
    totals = calculate_invoice_totals([line])
    assert totals.total_taxable == golden.taxable
    assert totals.total_cgst == golden.cgst
    assert totals.total_sgst == golden.sgst
    assert totals.round_off == golden.round_off
    assert totals.grand_total == golden.grand_total


def test_golden_043_exact_values() -> None:
    assert GOLDEN_043.taxable == Decimal("12280.00")
    assert GOLDEN_043.cgst == Decimal("1105.20")
    assert GOLDEN_043.sgst == Decimal("1105.20")
    assert GOLDEN_043.round_off == Decimal("-0.40")
    assert GOLDEN_043.grand_total == Decimal("14490.00")


def test_golden_089_exact_values() -> None:
    assert GOLDEN_089.taxable == Decimal("8332.00")
    assert GOLDEN_089.cgst == Decimal("749.88")
    assert GOLDEN_089.sgst == Decimal("749.88")
    assert GOLDEN_089.round_off == Decimal("0.24")
    assert GOLDEN_089.grand_total == Decimal("9832.00")


def test_fixtures_are_aggregate_pending_line_level_source() -> None:
    # Q-013: line-level source data is not available; fixtures are aggregate.
    assert LINE_LEVEL_SOURCE_AVAILABLE is False
