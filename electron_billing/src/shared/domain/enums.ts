/**
 * Domain enums (faithful port of Python `domain/enums.py`). String-valued so
 * they persist and serialize legibly.
 */

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  FINALIZED: 'FINALIZED',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const TaxType = {
  INTRA_STATE: 'INTRA_STATE',
  INTER_STATE: 'INTER_STATE',
} as const;
export type TaxType = (typeof TaxType)[keyof typeof TaxType];

/**
 * V1 supports only TAXABLE (DECISIONS D-007/D-008). Reverse charge, exempt,
 * nil-rated, zero-rated, export, and SEZ are explicitly out of scope and must
 * NOT be modeled as generic 0%.
 */
export const TaxTreatment = {
  TAXABLE: 'TAXABLE',
} as const;
export type TaxTreatment = (typeof TaxTreatment)[keyof typeof TaxTreatment];
