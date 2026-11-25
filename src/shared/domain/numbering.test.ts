import { describe, it, expect } from 'vitest';
import {
  financialYearFor,
  formatFinancialYear,
  formatInvoiceNumber,
  DEFAULT_NUMBERING_CONFIG,
} from './numbering';

describe('financial year (Indian, 1 Apr - 31 Mar)', () => {
  it('April onward maps to (year, year+1)', () => {
    const fy = financialYearFor(new Date(2026, 3, 1), 'IN'); // 1 Apr 2026
    expect(fy).toEqual({ start_year: 2026, end_year: 2027 });
    expect(formatFinancialYear(fy)).toBe('26-27');
  });

  it('Jan-Mar maps to (year-1, year)', () => {
    const fy = financialYearFor(new Date(2027, 2, 31), 'IN'); // 31 Mar 2027
    expect(fy).toEqual({ start_year: 2026, end_year: 2027 });
    expect(formatFinancialYear(fy)).toBe('26-27');
  });

  it('boundary: 31 Mar vs 1 Apr differ', () => {
    expect(formatFinancialYear(financialYearFor(new Date(2026, 2, 31), 'IN'))).toBe('25-26');
    expect(formatFinancialYear(financialYearFor(new Date(2026, 3, 1), 'IN'))).toBe('26-27');
  });
});

describe('invoice number formatting', () => {
  it('zero-pads to pad_width', () => {
    expect(formatInvoiceNumber(DEFAULT_NUMBERING_CONFIG, '26-27', 43)).toBe('SE/26-27/043');
    expect(formatInvoiceNumber(DEFAULT_NUMBERING_CONFIG, '26-27', 89)).toBe('SE/26-27/089');
  });

  it('widens naturally beyond pad_width', () => {
    expect(formatInvoiceNumber(DEFAULT_NUMBERING_CONFIG, '26-27', 1234)).toBe('SE/26-27/1234');
  });
});
