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

/**
 * The kind of invoice, driving the document number prefix, the printed title,
 * and which party master the invoice bills. A common invoice structure serves
 * all kinds (D-006 single engine still owns tax).
 *   - SALES     : bills a customer. Number prefix SE. Title "TAX INVOICE".
 *   - JOB_WORK  : bills a customer; service line items. Prefix JW. "JOB WORK INVOICE".
 *   - PURCHASE  : records a purchase from a vendor. Prefix PB. "PURCHASE INVOICE".
 *   - CUSTOM    : a plain sales invoice with no source document. Prefix SE.
 */
export const InvoiceKind = {
  SALES: 'SALES',
  JOB_WORK: 'JOB_WORK',
  PURCHASE: 'PURCHASE',
  CUSTOM: 'CUSTOM',
} as const;
export type InvoiceKind = (typeof InvoiceKind)[keyof typeof InvoiceKind];

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  SALES: 'Sales Invoice',
  JOB_WORK: 'Job Work Invoice',
  PURCHASE: 'Purchase Invoice',
  CUSTOM: 'Invoice',
};

/** The printed document title per kind. */
export const INVOICE_KIND_TITLE: Record<InvoiceKind, string> = {
  SALES: 'TAX INVOICE',
  JOB_WORK: 'JOB WORK INVOICE',
  PURCHASE: 'PURCHASE INVOICE',
  CUSTOM: 'TAX INVOICE',
};

/**
 * The printed copy marker on a GST tax invoice (standard Tally wording). This
 * is purely a presentation label: it never changes the invoice number,
 * snapshot, or any monetary value, so every copy reproduces identical content
 * (DECISIONS D-031). The default copy is ORIGINAL.
 */
export const InvoiceCopyType = {
  ORIGINAL: 'ORIGINAL',
  DUPLICATE: 'DUPLICATE',
  TRIPLICATE: 'TRIPLICATE',
} as const;
export type InvoiceCopyType = (typeof InvoiceCopyType)[keyof typeof InvoiceCopyType];

/** The printed marker text for each copy type (top-right of the invoice box). */
export const INVOICE_COPY_LABEL: Record<InvoiceCopyType, string> = {
  ORIGINAL: 'Original for Recipient',
  DUPLICATE: 'Duplicate for Supplier/Transporter',
  TRIPLICATE: 'Triplicate for Supplier',
};

/** Copy types in print/export order (Original, Duplicate, Triplicate). */
export const INVOICE_COPY_ORDER: InvoiceCopyType[] = [
  InvoiceCopyType.ORIGINAL,
  InvoiceCopyType.DUPLICATE,
  InvoiceCopyType.TRIPLICATE,
];

/** A line references a physical product or a service (SAC-based). */
export const LineItemType = {
  PRODUCT: 'PRODUCT',
  SERVICE: 'SERVICE',
} as const;
export type LineItemType = (typeof LineItemType)[keyof typeof LineItemType];
