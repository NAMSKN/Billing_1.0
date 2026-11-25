import type Decimal from 'decimal.js';
import { Money } from './money';
import type { InvoiceStatus } from './enums';
import type { Address, Company } from './models';

/**
 * Receipt / Payment voucher domain models.
 *
 * A voucher records money moving in or out and is a STANDALONE document:
 *   - RECEIPT: money received (inward). Counterparty is a customer. May be
 *     linked to one or more SALES / JOB_WORK invoices, or left unallocated
 *     (advance / deposit / other customer payment).
 *   - PAYMENT: money paid (outward). Counterparty is a vendor. May be linked to
 *     one or more PURCHASE invoices, or left unallocated.
 *
 * Allocation semantics (DECISIONS D-032, Option B):
 *   - A voucher may be allocated across one or more invoices.
 *   - Invoice payment_status and outstanding are DERIVED from CONFIRMED
 *     allocations only. Allocation requires explicit user confirmation.
 *   - Unallocated (or draft) vouchers never affect invoice status/outstanding.
 *
 * The voucher reuses the shared numbering sequence (own prefix per direction),
 * and the same immutability model as invoices: once finalized it is reproduced
 * from a stored snapshot and never re-derived. Money is Decimal in the domain;
 * conversion to integer paise happens only at the repository boundary.
 */

/** Direction of the money movement. */
export const VoucherDirection = {
  RECEIPT: 'RECEIPT',
  PAYMENT: 'PAYMENT',
} as const;
export type VoucherDirection = (typeof VoucherDirection)[keyof typeof VoucherDirection];

export const VOUCHER_DIRECTION_LABEL: Record<VoucherDirection, string> = {
  RECEIPT: 'Receipt',
  PAYMENT: 'Payment',
};

/** Printed document title per direction. */
export const VOUCHER_TITLE: Record<VoucherDirection, string> = {
  RECEIPT: 'RECEIPT VOUCHER',
  PAYMENT: 'PAYMENT VOUCHER',
};

/** The counterparty noun shown on the voucher/PDF per direction. */
export const VOUCHER_PARTY_LABEL: Record<VoucherDirection, string> = {
  RECEIPT: 'Received From',
  PAYMENT: 'Paid To',
};

/** How the money moved. Stored as the canonical code; labelled in UI/PDF. */
export const PaymentMode = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  CARD: 'CARD',
  OTHER: 'OTHER',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
};

/** Allocation lifecycle. Only CONFIRMED allocations affect invoice status. */
export const AllocationStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
} as const;
export type AllocationStatus = (typeof AllocationStatus)[keyof typeof AllocationStatus];

/** The counterparty snapshot (customer OR vendor) embedded into the voucher. */
export interface VoucherParty {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  address: Address;
}

/** A single allocation of a voucher's amount against one invoice. */
export interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  /** Denormalised for display; the invoice number at allocation time. */
  invoice_number: string;
  amount: Decimal;
  status: AllocationStatus;
}

/**
 * Immutable finalized snapshot — the authoritative reproduction source for a
 * finalized voucher (mirrors the invoice snapshot pattern, payment-flavoured).
 */
export interface PaymentSnapshot {
  company: Company;
  direction: VoucherDirection;
  party: VoucherParty;
  payment_date: string;
  amount: Decimal;
  mode: PaymentMode;
  reference_no: string;
  remarks: string;
  amount_words: string;
  /** Allocations as they stood at finalize (informational on the document). */
  allocations: { invoice_number: string; amount: Decimal }[];
}

export interface Payment {
  id: string;
  payment_number: string | null;
  status: InvoiceStatus; // DRAFT / FINALIZED / CANCELLED
  direction: VoucherDirection;
  company_id: string | null;
  party_id: string | null;
  /** The counterparty details as edited on the draft (snapshot at finalize). */
  party: VoucherParty;
  payment_date: string;
  amount: Decimal;
  mode: PaymentMode;
  reference_no: string;
  remarks: string;
  allocations: PaymentAllocation[];
  snapshot: PaymentSnapshot | null;
  cancelled_at: string;
  cancel_reason: string;
}

/** Sum of a voucher's allocations, optionally filtered by status. */
export function allocatedTotal(
  allocations: readonly PaymentAllocation[],
  status?: AllocationStatus,
): Decimal {
  return allocations
    .filter((a) => (status ? a.status === status : true))
    .reduce<Decimal>((sum, a) => sum.plus(a.amount), new Money(0));
}

/** Unallocated remainder of a voucher (amount minus allocations of a status). */
export function unallocatedAmount(
  amount: Decimal,
  allocations: readonly PaymentAllocation[],
  status?: AllocationStatus,
): Decimal {
  return amount.minus(allocatedTotal(allocations, status));
}
