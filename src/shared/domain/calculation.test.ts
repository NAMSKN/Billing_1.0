import { describe, it, expect } from 'vitest';
import { Money } from './money';
import { TaxType, TaxTreatment } from './enums';
import {
  calculateLine,
  calculateLineTax,
  determineTaxType,
  buildTaxSummary,
  taxSummaryReconciles,
  calculateInvoiceTotals,
  ensureSupportedTreatment,
  UnsupportedTaxTreatmentError,
  type TaxLineInput,
} from './calculation';
import { STANDARD_18 } from './fixtures/golden';

describe('calculateLine', () => {
  it('computes gross, discount, taxable with per-step quantization', () => {
    const r = calculateLine(new Money('16'), new Money('767.50'));
    expect(r.gross.toFixed(2)).toBe('12280.00');
    expect(r.discount.toFixed(2)).toBe('0.00');
    expect(r.taxable.toFixed(2)).toBe('12280.00');
  });

  it('applies discount before tax', () => {
    const r = calculateLine(new Money('10'), new Money('100'), new Money('10'));
    expect(r.gross.toFixed(2)).toBe('1000.00');
    expect(r.discount.toFixed(2)).toBe('100.00');
    expect(r.taxable.toFixed(2)).toBe('900.00');
  });
});

describe('determineTaxType', () => {
  it('returns INTRA_STATE for equal state codes', () => {
    expect(determineTaxType('29', '29')).toBe(TaxType.INTRA_STATE);
    expect(determineTaxType(' 29 ', '29')).toBe(TaxType.INTRA_STATE);
  });
  it('returns INTER_STATE for different state codes', () => {
    expect(determineTaxType('29', '27')).toBe(TaxType.INTER_STATE);
  });
});

describe('calculateLineTax', () => {
  it('intra-state uses configured CGST/SGST, IGST zero', () => {
    const t = calculateLineTax(new Money('12280.00'), TaxType.INTRA_STATE, STANDARD_18);
    expect(t.cgst.toFixed(2)).toBe('1105.20');
    expect(t.sgst.toFixed(2)).toBe('1105.20');
    expect(t.igst.toFixed(2)).toBe('0.00');
  });

  it('inter-state uses configured IGST, CGST/SGST zero', () => {
    const t = calculateLineTax(new Money('12280.00'), TaxType.INTER_STATE, STANDARD_18);
    expect(t.cgst.toFixed(2)).toBe('0.00');
    expect(t.sgst.toFixed(2)).toBe('0.00');
    expect(t.igst.toFixed(2)).toBe('2210.40');
  });
});

describe('tax treatment guard', () => {
  it('accepts TAXABLE', () => {
    expect(() => ensureSupportedTreatment(TaxTreatment.TAXABLE)).not.toThrow();
  });
  it('rejects anything else', () => {
    expect(() => ensureSupportedTreatment('EXEMPT' as TaxTreatment)).toThrow(
      UnsupportedTaxTreatmentError,
    );
  });
});

function intraInput(hsn: string, taxable: string): TaxLineInput {
  const t = calculateLineTax(new Money(taxable), TaxType.INTRA_STATE, STANDARD_18);
  return {
    hsn_sac: hsn,
    tax_treatment: TaxTreatment.TAXABLE,
    tax_type: TaxType.INTRA_STATE,
    tax_rate: STANDARD_18.total_rate,
    taxable: new Money(taxable),
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
  };
}

describe('buildTaxSummary', () => {
  it('groups by composite key and reconciles', () => {
    const lines = [intraInput('998898', '5000.00'), intraInput('998898', '7280.00')];
    const summary = buildTaxSummary(lines);
    expect(summary).toHaveLength(1);
    expect(summary[0].taxable_value.toFixed(2)).toBe('12280.00');
    expect(taxSummaryReconciles(summary, lines)).toBe(true);
  });

  it('keeps distinct HSN/SAC codes separate in first-appearance order', () => {
    const lines = [intraInput('998898', '5000.00'), intraInput('998877', '3000.00')];
    const summary = buildTaxSummary(lines);
    expect(summary.map((r) => r.hsn_sac)).toEqual(['998898', '998877']);
  });
});

describe('calculateInvoiceTotals round-off', () => {
  it('produces explicit round-off (grand = raw + round_off)', () => {
    const lines = [intraInput('998898', '12280.00')];
    const totals = calculateInvoiceTotals(lines);
    expect(totals.raw_total.toFixed(2)).toBe('14490.40');
    expect(totals.round_off.toFixed(2)).toBe('-0.40');
    expect(totals.grand_total.toFixed(2)).toBe('14490.00');
  });
});
