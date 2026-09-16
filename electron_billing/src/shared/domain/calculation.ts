import Decimal from 'decimal.js';
import { Money, quantizeMoney, roundToRupee } from './money';
import { TaxType, TaxTreatment } from './enums';
import type { InvoiceTotals, TaxRateConfig, TaxSummaryRow } from './models';

/**
 * The single authoritative calculation engine (faithful port of Python
 * `domain/calculation.py`, DECISIONS D-006). Pure functions only: no I/O, no
 * clock, no randomness. Every step quantizes to 2 dp with ROUND_HALF_UP, and
 * the quantization ORDER is preserved exactly so the golden invoices (043/089)
 * reproduce to the paise.
 */

const HUNDRED = new Money(100);

export interface LineAmounts {
  gross: Decimal;
  discount: Decimal;
  taxable: Decimal;
}

/**
 * Compute gross, discount, and taxable for one line. Quantization points match
 * the design: gross is quantized before the discount is applied, the discount
 * is quantized, and taxable is the quantized difference.
 */
export function calculateLine(
  quantity: Decimal,
  rate: Decimal,
  discountPercent: Decimal = new Money(0),
): LineAmounts {
  const gross = quantizeMoney(quantity.times(rate));
  const discount = quantizeMoney(gross.times(discountPercent).dividedBy(HUNDRED));
  const taxable = quantizeMoney(gross.minus(discount));
  return { gross, discount, taxable };
}

/** Raised when a GST treatment outside the V1 scope is requested. */
export class UnsupportedTaxTreatmentError extends Error {
  constructor(treatment: string) {
    super(`tax treatment '${treatment}' is not supported in V1`);
    this.name = 'UnsupportedTaxTreatmentError';
  }
}

export function ensureSupportedTreatment(treatment: TaxTreatment): void {
  if (treatment !== TaxTreatment.TAXABLE) {
    throw new UnsupportedTaxTreatmentError(treatment);
  }
}

/**
 * Determine tax type from company state vs the explicit Place of Supply. Equal
 * (trimmed) state codes -> INTRA_STATE (CGST+SGST); different -> INTER_STATE
 * (IGST). Place of Supply is the authoritative input (DECISIONS D-009).
 */
export function determineTaxType(
  companyStateCode: string,
  placeOfSupplyStateCode: string,
): TaxType {
  return companyStateCode.trim() === placeOfSupplyStateCode.trim()
    ? TaxType.INTRA_STATE
    : TaxType.INTER_STATE;
}

export interface LineTax {
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

/**
 * Per-line tax from explicit configured component rates. CGST/SGST are taken
 * from the configured components — never derived by halving total_rate
 * (DECISIONS D-030). A normal line carries either CGST+SGST or IGST, never both.
 */
export function calculateLineTax(
  taxable: Decimal,
  taxType: TaxType,
  config: TaxRateConfig,
): LineTax {
  const zero = quantizeMoney(new Money(0));
  if (taxType === TaxType.INTRA_STATE) {
    const cgst = quantizeMoney(taxable.times(config.cgst_rate).dividedBy(HUNDRED));
    const sgst = quantizeMoney(taxable.times(config.sgst_rate).dividedBy(HUNDRED));
    return { cgst, sgst, igst: zero };
  }
  const igst = quantizeMoney(taxable.times(config.igst_rate).dividedBy(HUNDRED));
  return { cgst: zero, sgst: zero, igst };
}

export interface TaxLineInput {
  hsn_sac: string;
  tax_treatment: TaxTreatment;
  tax_type: TaxType;
  tax_rate: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

/**
 * Group line contributions into a reconciling tax summary. Grouped by the
 * composite key {HSN/SAC + tax treatment + tax type + rate}, never HSN/SAC
 * alone. Groups are returned in first-appearance order for determinism.
 */
export function buildTaxSummary(lines: TaxLineInput[]): TaxSummaryRow[] {
  const order: string[] = [];
  const groups = new Map<
    string,
    {
      hsn_sac: string;
      tax_treatment: TaxTreatment;
      tax_type: TaxType;
      tax_rate: Decimal;
      taxable: Decimal;
      cgst: Decimal;
      sgst: Decimal;
      igst: Decimal;
    }
  >();

  for (const line of lines) {
    const key = `${line.hsn_sac}|${line.tax_treatment}|${line.tax_type}|${line.tax_rate.toString()}`;
    let acc = groups.get(key);
    if (!acc) {
      order.push(key);
      acc = {
        hsn_sac: line.hsn_sac,
        tax_treatment: line.tax_treatment,
        tax_type: line.tax_type,
        tax_rate: line.tax_rate,
        taxable: new Money(0),
        cgst: new Money(0),
        sgst: new Money(0),
        igst: new Money(0),
      };
      groups.set(key, acc);
    }
    acc.taxable = acc.taxable.plus(line.taxable);
    acc.cgst = acc.cgst.plus(line.cgst);
    acc.sgst = acc.sgst.plus(line.sgst);
    acc.igst = acc.igst.plus(line.igst);
  }

  return order.map((key) => {
    const acc = groups.get(key)!;
    const taxable = quantizeMoney(acc.taxable);
    const cgst = quantizeMoney(acc.cgst);
    const sgst = quantizeMoney(acc.sgst);
    const igst = quantizeMoney(acc.igst);
    return {
      hsn_sac: acc.hsn_sac,
      tax_treatment: acc.tax_treatment,
      tax_type: acc.tax_type,
      tax_rate: acc.tax_rate,
      taxable_value: taxable,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,
      total_tax: quantizeMoney(cgst.plus(sgst).plus(igst)),
    };
  });
}

/** True if the summary reconciles exactly to the line inputs (to the paise). */
export function taxSummaryReconciles(
  summary: TaxSummaryRow[],
  lines: TaxLineInput[],
): boolean {
  const sum = (arr: Decimal[]) =>
    quantizeMoney(arr.reduce((a, b) => a.plus(b), new Money(0)));

  const sumTaxable = sum(lines.map((l) => l.taxable));
  const sumCgst = sum(lines.map((l) => l.cgst));
  const sumSgst = sum(lines.map((l) => l.sgst));
  const sumIgst = sum(lines.map((l) => l.igst));

  const grpTaxable = sum(summary.map((r) => r.taxable_value));
  const grpCgst = sum(summary.map((r) => r.cgst_amount));
  const grpSgst = sum(summary.map((r) => r.sgst_amount));
  const grpIgst = sum(summary.map((r) => r.igst_amount));

  return (
    sumTaxable.equals(grpTaxable) &&
    sumCgst.equals(grpCgst) &&
    sumSgst.equals(grpSgst) &&
    sumIgst.equals(grpIgst)
  );
}

/**
 * Aggregate line taxable/tax amounts into invoice totals with explicit
 * round-off:
 *   raw_total     = total_taxable + total_cgst + total_sgst + total_igst
 *   rounded_total = round_to_rupee(raw_total)      (ROUND_HALF_UP)
 *   round_off     = rounded_total - raw_total       (may be + or -)
 *   grand_total   = raw_total + round_off           (== rounded_total)
 */
export function calculateInvoiceTotals(lines: TaxLineInput[]): InvoiceTotals {
  const sum = (arr: Decimal[]) =>
    quantizeMoney(arr.reduce((a, b) => a.plus(b), new Money(0)));

  const total_taxable = sum(lines.map((l) => l.taxable));
  const total_cgst = sum(lines.map((l) => l.cgst));
  const total_sgst = sum(lines.map((l) => l.sgst));
  const total_igst = sum(lines.map((l) => l.igst));

  const raw_total = quantizeMoney(
    total_taxable.plus(total_cgst).plus(total_sgst).plus(total_igst),
  );
  const rounded_total = roundToRupee(raw_total);
  const round_off = quantizeMoney(rounded_total.minus(raw_total));
  const grand_total = quantizeMoney(raw_total.plus(round_off));

  return {
    total_taxable,
    total_cgst,
    total_sgst,
    total_igst,
    raw_total,
    round_off,
    grand_total,
  };
}
