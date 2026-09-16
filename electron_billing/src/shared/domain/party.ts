import type Decimal from 'decimal.js';

/**
 * Unified Customer / Vendor "Party" master (V2 Feature 1). A single record
 * supports the customer role, the vendor role, or both (CUSTOMER_VENDOR), so a
 * dual-role business is never duplicated. Faithful port of the Python
 * `vendor_customer` domain.
 *
 * Money values are Decimal in the domain; conversion to integer paise happens
 * only at the repository boundary.
 */

export const PartyType = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  CUSTOMER_VENDOR: 'CUSTOMER_VENDOR',
} as const;
export type PartyType = (typeof PartyType)[keyof typeof PartyType];

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  CUSTOMER: 'Customer',
  VENDOR: 'Vendor',
  CUSTOMER_VENDOR: 'Customer / Vendor',
};

export function isCustomerType(t: PartyType): boolean {
  return t === PartyType.CUSTOMER || t === PartyType.CUSTOMER_VENDOR;
}
export function isVendorType(t: PartyType): boolean {
  return t === PartyType.VENDOR || t === PartyType.CUSTOMER_VENDOR;
}

export const RegistrationType = {
  UNREGISTERED: 'UNREGISTERED',
  REGULAR: 'REGULAR',
  REGULAR_SEZ: 'REGULAR_SEZ',
  REGULAR_UIN: 'REGULAR_UIN',
} as const;
export type RegistrationType = (typeof RegistrationType)[keyof typeof RegistrationType];

export const REGISTRATION_TYPE_LABEL: Record<RegistrationType, string> = {
  UNREGISTERED: 'Unregistered',
  REGULAR: 'Regular',
  REGULAR_SEZ: 'Regular-SEZ',
  REGULAR_UIN: 'Regular-UIN',
};

/** A GSTIN is mandatory for every registered type; unregistered must not have one. */
export function requiresGstin(t: RegistrationType): boolean {
  return t !== RegistrationType.UNREGISTERED;
}

export const BalanceType = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;
export type BalanceType = (typeof BalanceType)[keyof typeof BalanceType];

export const BALANCE_TYPE_LABEL: Record<BalanceType, string> = {
  DEBIT: 'Debit',
  CREDIT: 'Credit',
};

export const INDIA = 'India';

export interface PartyAddress {
  address1: string;
  address2: string;
  landmark: string;
  country: string;
  state: string;
  state_code: string;
  city: string;
  pincode: string;
}

export interface OpeningBalance {
  balance_type: BalanceType;
  amount: Decimal;
}

export interface PartyGroup {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Party {
  id: string;
  company_type: PartyType;
  company_name: string;
  contact_person: string;
  contact_no: string;
  email: string;
  registration_type: RegistrationType;
  gstin: string;
  pan: string;

  billing_address: PartyAddress;
  /** null means "same as billing". */
  shipping_address: PartyAddress | null;

  distance_for_eway_bill_km: Decimal | null;
  group_id: string | null;

  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;

  fax_no: string;
  website: string;
  credit_limit: Decimal | null;
  due_days: number | null;
  note: string;
  visible_on_documents: boolean;

  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;

  customer_balance: OpeningBalance;
  vendor_balance: OpeningBalance;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function emptyPartyAddress(): PartyAddress {
  return {
    address1: '',
    address2: '',
    landmark: '',
    country: INDIA,
    state: '',
    state_code: '',
    city: '',
    pincode: '',
  };
}

export function isAddressIndia(a: PartyAddress): boolean {
  return a.country.trim().toLowerCase() === INDIA.toLowerCase();
}

export function isAddressEmpty(a: PartyAddress): boolean {
  return !(
    a.address1.trim() ||
    a.address2.trim() ||
    a.landmark.trim() ||
    a.state.trim() ||
    a.state_code.trim() ||
    a.city.trim() ||
    a.pincode.trim()
  );
}
