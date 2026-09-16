import { describe, it, expect } from 'vitest';
import { TaxType, TaxTreatment } from './enums';
import {
  calculateLineTax,
  buildTaxSummary,
  calculateInvoiceTotals,
  taxSummaryReconciles,
  type TaxLineInput,
} from './calculation';
import { amountInWords } from './amountWords';
import { ALL_GOLDEN, GOLDEN_043, GOLDEN_089, type AggregateGoldenInvoice } from './fixtures/golden';

/**
 * Golden regression gate. The two source invoices must reproduce EXACTLY at the
 * aggregate level (testing rules). Money assertions compare exact Decimal
 * values, never float-tolerant comparisons.
 */

function aggregateInput(g: AggregateGoldenInvoice): TaxLineInput {
  // The fixtures are aggregate; construct one intra-state taxable input from
  // the known taxable value so the engine derives tax/totals.
  const tax = calculateLineTax(g.taxable, TaxType.INTRA_STATE, g.tax_config);
  return {
    hsn_sac: '998898',
    tax_treatment: TaxTreatment.TAXABLE,
    tax_type: TaxType.INTRA_STATE,
    tax_rate: g.tax_config.total_rate,
    taxable: g.taxable,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
  };
}

describe.each(ALL_GOLDEN)('golden invoice $invoice_number', (g) => {
  const input = aggregateInput(g);

  it('reproduces CGST and SGST exactly', () => {
    expect(input.cgst.equals(g.cgst)).toBe(true);
    expect(input.sgst.equals(g.sgst)).toBe(true);
  });

  it('reproduces taxable, round-off and grand total exactly', () => {
    const totals = calculateInvoiceTotals([input]);
    expect(totals.total_taxable.equals(g.taxable)).toBe(true);
    expect(totals.round_off.equals(g.round_off)).toBe(true);
    expect(totals.grand_total.equals(g.grand_total)).toBe(true);
  });

  it('tax summary reconciles to the line', () => {
    const summary = buildTaxSummary([input]);
    expect(taxSummaryReconciles(summary, [input])).toBe(true);
    expect(summary[0].total_tax.equals(g.cgst.plus(g.sgst))).toBe(true);
  });
});

describe('golden amount-in-words', () => {
  it('043 grand total in words', () => {
    expect(amountInWords(GOLDEN_043.grand_total)).toBe(
      'INR Fourteen Thousand Four Hundred Ninety Only',
    );
  });

  it('089 grand total in words', () => {
    expect(amountInWords(GOLDEN_089.grand_total)).toBe(
      'INR Nine Thousand Eight Hundred Thirty Two Only',
    );
  });

  it('043 tax amount (cgst+sgst) in words with paise', () => {
    const tax = GOLDEN_043.cgst.plus(GOLDEN_043.sgst); // 2210.40
    expect(amountInWords(tax)).toBe('INR Two Thousand Two Hundred Ten and Forty Paise Only');
  });
});
