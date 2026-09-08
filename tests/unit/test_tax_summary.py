"""Unit tests for the tax summary (composite-key grouping + reconciliation)."""

from __future__ import annotations

from decimal import Decimal

from invoice_generator.domain.calculation import (
    TaxLineInput,
    build_tax_summary,
    tax_summary_reconciles,
)
from invoice_generator.domain.enums import TaxTreatment, TaxType


def _intra(hsn: str, rate: str, taxable: str, cgst: str, sgst: str) -> TaxLineInput:
    return TaxLineInput(
        hsn_sac=hsn,
        tax_treatment=TaxTreatment.TAXABLE,
        tax_type=TaxType.INTRA_STATE,
        tax_rate=Decimal(rate),
        taxable=Decimal(taxable),
        cgst=Decimal(cgst),
        sgst=Decimal(sgst),
        igst=Decimal("0.00"),
    )


def test_single_group_merges_same_key_lines() -> None:
    lines = [
        _intra("998898", "18", "5000.00", "450.00", "450.00"),
        _intra("998898", "18", "7280.00", "655.20", "655.20"),
    ]
    summary = build_tax_summary(lines)
    assert len(summary) == 1
    row = summary[0]
    assert row.hsn_sac == "998898"
    assert row.taxable_value == Decimal("12280.00")
    assert row.cgst_amount == Decimal("1105.20")
    assert row.sgst_amount == Decimal("1105.20")
    assert row.total_tax == Decimal("2210.40")


def test_multiple_hsn_codes_form_separate_groups() -> None:
    lines = [
        _intra("998898", "18", "1000.00", "90.00", "90.00"),
        _intra("998877", "18", "2000.00", "180.00", "180.00"),
    ]
    summary = build_tax_summary(lines)
    assert len(summary) == 2
    assert {r.hsn_sac for r in summary} == {"998898", "998877"}


def test_same_hsn_different_rate_forms_separate_groups() -> None:
    # Composite key includes the rate; same HSN at different rates must not merge.
    lines = [
        _intra("998898", "18", "1000.00", "90.00", "90.00"),
        _intra("998898", "12", "1000.00", "60.00", "60.00"),
    ]
    summary = build_tax_summary(lines)
    assert len(summary) == 2
    rates = {r.tax_rate for r in summary}
    assert rates == {Decimal("18"), Decimal("12")}


def test_intra_and_inter_same_hsn_rate_are_separate_groups() -> None:
    intra = _intra("998898", "18", "1000.00", "90.00", "90.00")
    inter = TaxLineInput(
        hsn_sac="998898",
        tax_treatment=TaxTreatment.TAXABLE,
        tax_type=TaxType.INTER_STATE,
        tax_rate=Decimal("18"),
        taxable=Decimal("1000.00"),
        cgst=Decimal("0.00"),
        sgst=Decimal("0.00"),
        igst=Decimal("180.00"),
    )
    summary = build_tax_summary([intra, inter])
    assert len(summary) == 2
    assert {r.tax_type for r in summary} == {TaxType.INTRA_STATE, TaxType.INTER_STATE}


def test_first_appearance_order_is_preserved() -> None:
    lines = [
        _intra("B", "18", "100.00", "9.00", "9.00"),
        _intra("A", "18", "100.00", "9.00", "9.00"),
    ]
    summary = build_tax_summary(lines)
    assert [r.hsn_sac for r in summary] == ["B", "A"]


def test_summary_reconciles_to_lines() -> None:
    lines = [
        _intra("998898", "18", "5000.00", "450.00", "450.00"),
        _intra("998877", "18", "2000.00", "180.00", "180.00"),
        _intra("998898", "18", "7280.00", "655.20", "655.20"),
    ]
    summary = build_tax_summary(lines)
    assert tax_summary_reconciles(summary, lines) is True


def test_empty_lines_yield_empty_summary() -> None:
    summary = build_tax_summary([])
    assert summary == ()
    assert tax_summary_reconciles(summary, []) is True
