import { Money } from './money';
import {
  RegistrationType,
  requiresGstin,
  isAddressIndia,
  isAddressEmpty,
  type Party,
  type PartyAddress,
} from './party';

/**
 * Party validation (faithful port of the Python `vendor_customer/domain/rules.py`).
 * Format-only, offline. Returns a list of human-readable error strings; empty
 * means valid. No auto-fill: PAN and state code are never derived from GSTIN.
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_RE.test(value);
}
export function isValidPan(value: string): boolean {
  return PAN_RE.test(value);
}

function validateAddress(address: PartyAddress, label: string, errors: string[]): void {
  if (isAddressIndia(address) && !isAddressEmpty(address)) {
    if (!address.state.trim()) errors.push(`${label} state is required for an India address.`);
    if (!address.city.trim()) errors.push(`${label} city is required for an India address.`);
  }
}

export function validateParty(party: Party): string[] {
  const errors: string[] = [];

  if (!party.company_name.trim()) {
    errors.push('Company name is required.');
  }

  // Registration vs GSTIN.
  const gstin = party.gstin.trim().toUpperCase();
  if (requiresGstin(party.registration_type)) {
    if (!gstin) {
      const label = party.registration_type;
      errors.push(`GSTIN is required for registration type '${label}'.`);
    }
  } else if (gstin) {
    errors.push('An Unregistered party must not have a GSTIN.');
  }
  if (gstin && !isValidGstinFormat(gstin)) {
    errors.push('GSTIN format is invalid.');
  }

  if (party.pan.trim() && !isValidPan(party.pan.trim().toUpperCase())) {
    errors.push('PAN format is invalid.');
  }
  if (party.bank_ifsc_code.trim() && !IFSC_RE.test(party.bank_ifsc_code.trim().toUpperCase())) {
    errors.push('Bank IFSC format is invalid.');
  }
  if (party.email.trim() && !EMAIL_RE.test(party.email.trim())) {
    errors.push('Email format is invalid.');
  }

  // Addresses (billing always; shipping only when present + non-empty).
  validateAddress(party.billing_address, 'Billing', errors);
  if (party.shipping_address && !isAddressEmpty(party.shipping_address)) {
    validateAddress(party.shipping_address, 'Shipping', errors);
  }

  // Non-negative numerics.
  const ZERO = new Money(0);
  if (party.distance_for_eway_bill_km && party.distance_for_eway_bill_km.lessThan(ZERO)) {
    errors.push('E-Way Bill distance must not be negative.');
  }
  if (party.credit_limit && party.credit_limit.lessThan(ZERO)) {
    errors.push('Credit limit must not be negative.');
  }
  if (party.due_days !== null && party.due_days < 0) {
    errors.push('Due days must not be negative.');
  }
  if (party.customer_balance.amount.lessThan(ZERO)) {
    errors.push('Customer balance amount must not be negative.');
  }
  if (party.vendor_balance.amount.lessThan(ZERO)) {
    errors.push('Vendor balance amount must not be negative.');
  }

  return errors;
}

/** Registration type is unregistered-friendly for GSTIN. */
export { RegistrationType };
