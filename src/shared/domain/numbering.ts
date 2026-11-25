/**
 * Invoice numbering domain logic (faithful port of Python `domain/numbering.py`).
 * Pure functions for financial-year derivation and number formatting. The
 * transactional allocation with high-water mark lives in the application layer
 * (numbering service, Phase 4).
 *
 * Format: PREFIX/FY/NNN, e.g. "SE/26-27/043".
 */

export interface NumberingConfig {
  prefix: string;
  pad_width: number;
  start_value: number;
  fy_scheme: string; // "IN" for Indian financial year
}

export const DEFAULT_NUMBERING_CONFIG: NumberingConfig = {
  prefix: 'SE',
  pad_width: 3,
  start_value: 1,
  fy_scheme: 'IN',
};

export interface FinancialYear {
  start_year: number;
  end_year: number;
}

/**
 * Indian financial year for a date: 1 April - 31 March. Month >= April (4) maps
 * to (year, year+1); otherwise (year-1, year). A non-IN scheme falls back to a
 * calendar year.
 */
export function financialYearFor(invoiceDate: Date, scheme: string): FinancialYear {
  const year = invoiceDate.getFullYear();
  const month = invoiceDate.getMonth() + 1; // 1-12
  if (scheme !== 'IN') {
    return { start_year: year, end_year: year };
  }
  if (month >= 4) {
    return { start_year: year, end_year: year + 1 };
  }
  return { start_year: year - 1, end_year: year };
}

/** Format a financial year as "YY-YY" (e.g. "26-27"). */
export function formatFinancialYear(fy: FinancialYear): string {
  const start = String(fy.start_year % 100).padStart(2, '0');
  const end = String(fy.end_year % 100).padStart(2, '0');
  return `${start}-${end}`;
}

/**
 * Format an invoice number PREFIX/FY/NNN with zero-padding to pad_width. A
 * sequence wider than pad_width widens naturally (never truncates).
 */
export function formatInvoiceNumber(
  config: NumberingConfig,
  fyLabel: string,
  sequence: number,
): string {
  const seq = String(sequence).padStart(config.pad_width, '0');
  return `${config.prefix}/${fyLabel}/${seq}`;
}
