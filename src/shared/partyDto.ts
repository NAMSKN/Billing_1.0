import type { PartyType, RegistrationType, BalanceType } from './domain/party';

/**
 * Wire DTOs for the Party master. Money/decimal values cross IPC as decimal
 * strings (e.g. "12500.00"), never floats. The main process converts to/from
 * Decimal at its boundary.
 */

export interface PartyAddressDto {
  address1: string;
  address2: string;
  landmark: string;
  country: string;
  state: string;
  state_code: string;
  city: string;
  pincode: string;
}

export interface OpeningBalanceDto {
  balance_type: BalanceType;
  amount: string;
}

export interface PartyGroupDto {
  id: string;
  name: string;
  is_active: boolean;
}

export interface PartyDto {
  id: string;
  company_type: PartyType;
  company_name: string;
  contact_person: string;
  contact_no: string;
  email: string;
  registration_type: RegistrationType;
  gstin: string;
  pan: string;
  billing_address: PartyAddressDto;
  shipping_address: PartyAddressDto | null;
  distance_for_eway_bill_km: string | null;
  group_id: string | null;
  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;
  fax_no: string;
  website: string;
  credit_limit: string | null;
  due_days: number | null;
  note: string;
  visible_on_documents: boolean;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  customer_balance: OpeningBalanceDto;
  vendor_balance: OpeningBalanceDto;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Derived, read-only for the list: "C: ₹12,500.00 Cr  V: ₹32,500.00 Dr". */
  balance_summary?: string;
}

/** Party list request. */
export interface PartyListRequest {
  role: 'ALL' | PartyType;
  includeArchived: boolean;
  search?: string;
}

/** Excel import DTOs. */
export type ImportAsDto = 'FILE' | 'CUSTOMER' | 'VENDOR' | 'CUSTOMER_VENDOR';
export type DuplicateResolutionDto = 'UPDATE' | 'SKIP' | 'CREATE_NEW';

export interface ImportRowDto {
  row_number: number;
  company_name: string;
  errors: string[];
  duplicate_of_name: string | null;
  resolution: DuplicateResolutionDto;
  valid: boolean;
}

export interface ImportPreviewDto {
  /** Opaque token the main process uses to re-locate the parsed preview on commit. */
  token: string;
  header_errors: string[];
  rows: ImportRowDto[];
  valid_count: number;
  error_count: number;
  duplicate_count: number;
}

export interface ImportResultDto {
  created: number;
  updated: number;
  skipped: number;
}

export interface ExportRequest {
  scope: 'CUSTOMERS' | 'VENDORS' | 'BOTH';
  includeArchived: boolean;
}
