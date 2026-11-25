import Decimal from 'decimal.js';
import { Money } from '../money';
import type { TaxRateConfig } from '../models';

/**
 * Golden regression fixtures (faithful port of tests/fixtures/golden_invoices.py).
 * These are AGGREGATE fixtures — line-level source data is not available
 * (OPEN_QUESTIONS Q-013), so we assert aggregate totals only.
 *
 * The two source invoices must reproduce exactly (testing rules):
 *   Invoice 043: taxable 12280.00; CGST 1105.20; SGST 1105.20; round-off -0.40; grand 14490.00.
 *   Invoice 089: taxable  8332.00; CGST  749.88; SGST  749.88; round-off +0.24; grand  9832.00.
 */

export const STANDARD_18: TaxRateConfig = {
  total_rate: new Money(18),
  cgst_rate: new Money(9),
  sgst_rate: new Money(9),
  igst_rate: new Money(18),
};

export interface AggregateGoldenInvoice {
  invoice_number: string;
  customer: string;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  round_off: Decimal;
  grand_total: Decimal;
  tax_config: TaxRateConfig;
}

export const GOLDEN_043: AggregateGoldenInvoice = {
  invoice_number: 'SE/26-27/043',
  customer: 'DI-TECH MOULDS',
  taxable: new Money('12280.00'),
  cgst: new Money('1105.20'),
  sgst: new Money('1105.20'),
  round_off: new Money('-0.40'),
  grand_total: new Money('14490.00'),
  tax_config: STANDARD_18,
};

export const GOLDEN_089: AggregateGoldenInvoice = {
  invoice_number: 'SE/26-27/089',
  customer: 'BMSS STEEL INDUSTRIES PRIVATE LIMITED',
  taxable: new Money('8332.00'),
  cgst: new Money('749.88'),
  sgst: new Money('749.88'),
  round_off: new Money('0.24'),
  grand_total: new Money('9832.00'),
  tax_config: STANDARD_18,
};

export const ALL_GOLDEN = [GOLDEN_043, GOLDEN_089];
