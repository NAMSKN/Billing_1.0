import type {
  AllocationStatus,
  PaymentMode,
  VoucherDirection,
} from './domain/payment';
import type { InvoiceStatus, PaymentStatus } from './domain/enums';
import type { AddressDto } from './challanDto';

/**
 * Receipt / Payment voucher wire DTOs. Every monetary value is a decimal STRING
 * (never a float); the main process parses/formats via paymentDtoMappers.
 */

export interface VoucherPartyDto {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  address: AddressDto;
}

export interface PaymentAllocationDto {
  id: string;
  payment_id: string;
  invoice_id: string;
  invoice_number: string;
  amount: string;
  status: AllocationStatus;
}

export interface PaymentDto {
  id: string;
  payment_number: string | null;
  status: InvoiceStatus;
  direction: VoucherDirection;
  company_id: string | null;
  party_id: string | null;
  party: VoucherPartyDto;
  payment_date: string;
  amount: string;
  mode: PaymentMode;
  reference_no: string;
  remarks: string;
  allocations: PaymentAllocationDto[];
  cancelled_at: string;
  cancel_reason: string;
}

/** Editable fields sent when saving a draft voucher. */
export interface PaymentDraftInputDto {
  direction: VoucherDirection;
  party_id: string | null;
  payment_date: string;
  amount: string;
  mode: PaymentMode;
  reference_no: string;
  remarks: string;
}

/** A candidate invoice for allocation, with its live outstanding balance. */
export interface AllocatableInvoiceDto {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: string;
  outstanding: string;
  payment_status: PaymentStatus;
}

/** One requested allocation line (invoice + amount). */
export interface AllocationInputDto {
  invoice_id: string;
  amount: string;
}
