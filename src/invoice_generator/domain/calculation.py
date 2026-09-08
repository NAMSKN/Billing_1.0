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

Task 8 adds tax determination: the tax type (intra- vs inter-state) is derived
from the company state versus the explicit Place of Supply (design section 4,
DECISIONS D-009), and only ``TaxTreatment.TAXABLE`` is supported in V1
(DECISIONS D-008) — unsupported treatments raise rather than being silently
taxed at 0%.

Task 9 adds per-line tax: CGST/SGST (intra-state) or IGST (inter-state),
computed from the explicit component rates in ``TaxRateConfig`` (DECISIONS
D-030). CGST/SGST are never derived by halving the total rate, and a single
line never carries both the CGST/SGST pair and IGST.

Task 10 adds the tax summary: lines are folded into groups keyed by the
composite {HSN/SAC + tax treatment + tax type + applicable rate}, never by
HSN/SAC alone (design section 6, finding 3.4). The summary reconciles exactly
to the summed line taxable and tax amounts.

Task 11 adds invoice totals and explicit round-off (design section 5):
``raw_total`` is the sum of taxable and tax components; ``round_off`` is
``round_to_rupee(raw_total) - raw_total`` (may be positive or negative); and
``grand_total = raw_total + round_off``.

Functions are pure: no I/O, no clock, no global state.

References: requirements Req 6, 7.1, 11; DECISIONS D-004, D-006, D-008, D-009;
design sections 4, 5.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from invoice_generator.domain.enums import TaxTreatment, TaxType
from invoice_generator.domain.models import InvoiceTotals, TaxRateConfig, TaxSummaryRow
from invoice_generator.domain.money import quantize_money, round_to_rupee

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


class UnsupportedTaxTreatmentError(ValueError):
    """Raised when a GST treatment outside the V1 scope is requested.

    V1 supports only :attr:`~invoice_generator.domain.enums.TaxTreatment.TAXABLE`
    (DECISIONS D-007/D-008). Reverse charge, exempt, nil-rated, zero-rated,
    export, and SEZ are explicitly out of scope and MUST NOT be silently taxed
    at 0%.
    """


def ensure_supported_treatment(treatment: TaxTreatment) -> None:
    """Raise :class:`UnsupportedTaxTreatmentError` unless ``treatment`` is TAXABLE."""
    if treatment is not TaxTreatment.TAXABLE:
        raise UnsupportedTaxTreatmentError(
            f"tax treatment {treatment.value!r} is not supported in V1"
        )


def determine_tax_type(
    company_state_code: str,
    place_of_supply_state_code: str,
) -> TaxType:
    """Return the tax type from company state vs the explicit Place of Supply.

    Intra-state (same state) → ``INTRA_STATE`` (CGST + SGST); different state →
    ``INTER_STATE`` (IGST). Place of Supply is the authoritative input
    (DECISIONS D-009); this determination happens in the engine, never in the
    UI (design section 4). State codes are compared after trimming surrounding
    whitespace.
    """
    company = company_state_code.strip()
    place = place_of_supply_state_code.strip()
    if company == place:
        return TaxType.INTRA_STATE
    return TaxType.INTER_STATE


@dataclass(frozen=True)
class LineTax:
    """Per-line tax component amounts, each quantized to 2 dp.

    Only the components applicable to the invoice's tax type are non-zero: a
    single normal supply line carries either CGST+SGST (intra-state) or IGST
    (inter-state), never both (design section 4).
    """

    cgst: Decimal
    sgst: Decimal
    igst: Decimal


def calculate_line_tax(
    taxable: Decimal,
    tax_type: TaxType,
    config: TaxRateConfig,
) -> LineTax:
    """Compute per-line tax from explicit configured component rates.

    Intra-state: ``cgst = taxable * config.cgst_rate / 100`` and
    ``sgst = taxable * config.sgst_rate / 100`` (IGST zero). Inter-state:
    ``igst = taxable * config.igst_rate / 100`` (CGST/SGST zero). CGST/SGST are
    taken from the configured components — never derived by halving
    ``total_rate`` (DECISIONS D-030). Each amount is quantized to 2 dp.
    """
    zero = quantize_money(Decimal(0))
    if tax_type is TaxType.INTRA_STATE:
        cgst = quantize_money(taxable * config.cgst_rate / _HUNDRED)
        sgst = quantize_money(taxable * config.sgst_rate / _HUNDRED)
        return LineTax(cgst=cgst, sgst=sgst, igst=zero)
    igst = quantize_money(taxable * config.igst_rate / _HUNDRED)
    return LineTax(cgst=zero, sgst=zero, igst=igst)


@dataclass(frozen=True)
class TaxLineInput:
    """One line's already-calculated contribution to the tax summary.

    Carries the composite grouping key ({HSN/SAC, treatment, tax type, rate})
    and the line's calculated taxable and tax component amounts.
    """

    hsn_sac: str
    tax_treatment: TaxTreatment
    tax_type: TaxType
    tax_rate: Decimal
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal


def build_tax_summary(lines: Sequence[TaxLineInput]) -> tuple[TaxSummaryRow, ...]:
    """Group line contributions into a reconciling tax summary.

    Lines are grouped by the composite key {HSN/SAC + tax treatment + tax type
    + applicable rate} (design section 6, finding 3.4). Within each group the
    taxable value and CGST/SGST/IGST amounts are summed and ``total_tax`` is
    their sum. Groups are returned in first-appearance order for determinism.

    The result reconciles exactly to the summed inputs: the sum of group
    taxable values equals the sum of line taxables, and likewise for each tax
    component (verified by :func:`tax_summary_reconciles`).
    """
    order: list[tuple[str, TaxTreatment, TaxType, Decimal]] = []
    groups: dict[tuple[str, TaxTreatment, TaxType, Decimal], dict[str, Decimal]] = {}

    for line in lines:
        key = (line.hsn_sac, line.tax_treatment, line.tax_type, line.tax_rate)
        if key not in groups:
            order.append(key)
            groups[key] = {
                "taxable": Decimal(0),
                "cgst": Decimal(0),
                "sgst": Decimal(0),
                "igst": Decimal(0),
            }
        acc = groups[key]
        acc["taxable"] += line.taxable
        acc["cgst"] += line.cgst
        acc["sgst"] += line.sgst
        acc["igst"] += line.igst

    rows: list[TaxSummaryRow] = []
    for hsn_sac, treatment, tax_type, rate in order:
        acc = groups[(hsn_sac, treatment, tax_type, rate)]
        taxable = quantize_money(acc["taxable"])
        cgst = quantize_money(acc["cgst"])
        sgst = quantize_money(acc["sgst"])
        igst = quantize_money(acc["igst"])
        rows.append(
            TaxSummaryRow(
                hsn_sac=hsn_sac,
                tax_treatment=treatment,
                tax_type=tax_type,
                tax_rate=rate,
                taxable_value=taxable,
                cgst_amount=cgst,
                sgst_amount=sgst,
                igst_amount=igst,
                total_tax=quantize_money(cgst + sgst + igst),
            )
        )
    return tuple(rows)


def tax_summary_reconciles(
    summary: Sequence[TaxSummaryRow],
    lines: Sequence[TaxLineInput],
) -> bool:
    """Return True if ``summary`` reconciles exactly to the line inputs.

    Checks that summed taxable and each summed tax component across the summary
    equal the summed line values (to the paise).
    """
    sum_taxable = quantize_money(sum((line.taxable for line in lines), Decimal(0)))
    sum_cgst = quantize_money(sum((line.cgst for line in lines), Decimal(0)))
    sum_sgst = quantize_money(sum((line.sgst for line in lines), Decimal(0)))
    sum_igst = quantize_money(sum((line.igst for line in lines), Decimal(0)))

    grp_taxable = quantize_money(sum((r.taxable_value for r in summary), Decimal(0)))
    grp_cgst = quantize_money(sum((r.cgst_amount for r in summary), Decimal(0)))
    grp_sgst = quantize_money(sum((r.sgst_amount for r in summary), Decimal(0)))
    grp_igst = quantize_money(sum((r.igst_amount for r in summary), Decimal(0)))

    return (
        sum_taxable == grp_taxable
        and sum_cgst == grp_cgst
        and sum_sgst == grp_sgst
        and sum_igst == grp_igst
    )


def calculate_invoice_totals(lines: Sequence[TaxLineInput]) -> InvoiceTotals:
    """Aggregate line taxable/tax amounts into invoice totals with round-off.

    Sums the per-line taxable and CGST/SGST/IGST amounts, computes the raw
    total, then the explicit round-off to the nearest rupee (design section 5):

        raw_total     = total_taxable + total_cgst + total_sgst + total_igst
        rounded_total = round_to_rupee(raw_total)     # ROUND_HALF_UP
        round_off     = rounded_total - raw_total      # may be + or -
        grand_total   = raw_total + round_off          # == rounded_total

    All values are quantized to 2 dp.
    """
    total_taxable = quantize_money(sum((line.taxable for line in lines), Decimal(0)))
    total_cgst = quantize_money(sum((line.cgst for line in lines), Decimal(0)))
    total_sgst = quantize_money(sum((line.sgst for line in lines), Decimal(0)))
    total_igst = quantize_money(sum((line.igst for line in lines), Decimal(0)))

    raw_total = quantize_money(total_taxable + total_cgst + total_sgst + total_igst)
    rounded_total = round_to_rupee(raw_total)
    round_off = quantize_money(rounded_total - raw_total)
    grand_total = quantize_money(raw_total + round_off)

    return InvoiceTotals(
        total_taxable=total_taxable,
        total_cgst=total_cgst,
        total_sgst=total_sgst,
        total_igst=total_igst,
        raw_total=raw_total,
        round_off=round_off,
        grand_total=grand_total,
    )
