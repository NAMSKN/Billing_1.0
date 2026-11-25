import { describe, it, expect } from 'vitest';
import { Money } from './money';
import {
  PartyType,
  RegistrationType,
  BalanceType,
  isCustomerType,
  isVendorType,
  requiresGstin,
  emptyPartyAddress,
  type Party,
} from './party';
import { validateParty, isValidGstinFormat, isValidPan } from './partyValidation';

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    company_type: PartyType.CUSTOMER,
    company_name: 'Acme Moulds',
    contact_person: '',
    contact_no: '',
    email: '',
    registration_type: RegistrationType.UNREGISTERED,
    gstin: '',
    pan: '',
    billing_address: { ...emptyPartyAddress(), state: 'Karnataka', state_code: '29', city: 'Bengaluru' },
    shipping_address: null,
    distance_for_eway_bill_km: null,
    group_id: null,
    bank_name: '',
    bank_ifsc_code: '',
    bank_account_number: '',
    fax_no: '',
    website: '',
    credit_limit: null,
    due_days: null,
    note: '',
    visible_on_documents: false,
    custom_field_1: '',
    custom_field_2: '',
    custom_field_3: '',
    customer_balance: { balance_type: BalanceType.DEBIT, amount: new Money(0) },
    vendor_balance: { balance_type: BalanceType.DEBIT, amount: new Money(0) },
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('party role helpers', () => {
  it('CUSTOMER_VENDOR is both a customer and a vendor', () => {
    expect(isCustomerType(PartyType.CUSTOMER_VENDOR)).toBe(true);
    expect(isVendorType(PartyType.CUSTOMER_VENDOR)).toBe(true);
    expect(isCustomerType(PartyType.VENDOR)).toBe(false);
    expect(isVendorType(PartyType.CUSTOMER)).toBe(false);
  });

  it('requiresGstin is true for every registered type', () => {
    expect(requiresGstin(RegistrationType.UNREGISTERED)).toBe(false);
    expect(requiresGstin(RegistrationType.REGULAR)).toBe(true);
    expect(requiresGstin(RegistrationType.REGULAR_SEZ)).toBe(true);
    expect(requiresGstin(RegistrationType.REGULAR_UIN)).toBe(true);
  });
});

describe('format validators', () => {
  it('GSTIN 15-char format', () => {
    expect(isValidGstinFormat('29ABCDE1234F1Z5')).toBe(true);
    expect(isValidGstinFormat('BAD')).toBe(false);
  });
  it('PAN format', () => {
    expect(isValidPan('ABCDE1234F')).toBe(true);
    expect(isValidPan('ABC')).toBe(false);
  });
});

describe('validateParty', () => {
  it('accepts a minimal valid customer', () => {
    expect(validateParty(party())).toEqual([]);
  });

  it('requires a company name', () => {
    expect(validateParty(party({ company_name: '' }))).toContain('Company name is required.');
  });

  it('requires GSTIN for a registered type', () => {
    const errs = validateParty(party({ registration_type: RegistrationType.REGULAR }));
    expect(errs.some((e) => e.includes('GSTIN is required'))).toBe(true);
  });

  it('rejects a GSTIN on an unregistered party', () => {
    const errs = validateParty(party({ gstin: '29ABCDE1234F1Z5' }));
    expect(errs).toContain('An Unregistered party must not have a GSTIN.');
  });

  it('accepts a registered party with a valid GSTIN', () => {
    const errs = validateParty(
      party({ registration_type: RegistrationType.REGULAR, gstin: '29ABCDE1234F1Z5' }),
    );
    expect(errs).toEqual([]);
  });

  it('requires state and city for an India billing address', () => {
    const errs = validateParty(
      party({
        billing_address: { ...emptyPartyAddress(), address1: '12 Road' },
      }),
    );
    expect(errs.some((e) => e.includes('state is required'))).toBe(true);
    expect(errs.some((e) => e.includes('city is required'))).toBe(true);
  });

  it('rejects negative opening balances', () => {
    const errs = validateParty(
      party({ customer_balance: { balance_type: BalanceType.DEBIT, amount: new Money('-5') } }),
    );
    expect(errs.some((e) => e.includes('Customer balance'))).toBe(true);
  });
});
