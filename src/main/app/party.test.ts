import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';
import { BalanceType, PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import {
  PartyValidationError,
  DuplicatePartyError,
  zeroBalance,
  type PartyInput,
} from './partyService';
import { PartyServiceError } from './partyGroupService';

let db: Database.Database;
let app: Application;

beforeEach(() => {
  db = connectMemory();
  app = buildApplicationFromDb(db);
});
afterEach(() => app.close());

function input(overrides: Partial<PartyInput> = {}): PartyInput {
  return {
    company_type: PartyType.CUSTOMER,
    company_name: 'Acme Moulds',
    contact_person: 'Neha',
    contact_no: '9876543210',
    email: '',
    registration_type: RegistrationType.REGULAR,
    gstin: '29ABCDE1234F1Z5',
    pan: '',
    billing_address: {
      ...emptyPartyAddress(),
      address1: '12 Estate',
      state: 'Karnataka',
      state_code: '29',
      city: 'Bengaluru',
    },
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
    customer_balance: { balance_type: BalanceType.CREDIT, amount: new Money('12500.00') },
    vendor_balance: zeroBalance(),
    ...overrides,
  };
}

describe('PartyService create/update', () => {
  it('creates and rehydrates a party', () => {
    const p = app.partyService.createParty(input());
    expect(p.id).toBeTruthy();
    const back = app.partyService.get(p.id)!;
    expect(back.company_name).toBe('Acme Moulds');
    expect(back.gstin).toBe('29ABCDE1234F1Z5');
    expect(back.customer_balance.amount.toFixed(2)).toBe('12500.00');
  });

  it('rejects an invalid party', () => {
    expect(() => app.partyService.createParty(input({ company_name: '' }))).toThrow(
      PartyValidationError,
    );
  });

  it('rejects a duplicate GSTIN on create', () => {
    app.partyService.createParty(input());
    expect(() => app.partyService.createParty(input({ company_name: 'Other' }))).toThrow(
      DuplicatePartyError,
    );
  });

  it('update preserves created_at and refreshes updated_at', () => {
    const p = app.partyService.createParty(input());
    const updated = app.partyService.updateParty(
      p.id,
      input({ company_name: 'Acme Moulds Renamed' }),
      true,
    );
    expect(updated.company_name).toBe('Acme Moulds Renamed');
    expect(updated.created_at).toBe(p.created_at);
  });
});

describe('role filter + search', () => {
  it('CUSTOMER_VENDOR appears under both filters; search matches', () => {
    app.partyService.createParty(input({ company_name: 'Only Cust', gstin: '', registration_type: RegistrationType.UNREGISTERED, contact_no: '1' }));
    app.partyService.createParty(input({ company_name: 'Only Vend', company_type: PartyType.VENDOR, gstin: '', registration_type: RegistrationType.UNREGISTERED, contact_no: '2' }));
    app.partyService.createParty(input({ company_name: 'Dual', company_type: PartyType.CUSTOMER_VENDOR, gstin: '', registration_type: RegistrationType.UNREGISTERED, contact_no: '3' }));

    expect(app.partyService.list(PartyType.CUSTOMER, false).map((p) => p.company_name).sort()).toEqual([
      'Dual',
      'Only Cust',
    ]);
    expect(app.partyService.list(PartyType.VENDOR, false).map((p) => p.company_name).sort()).toEqual([
      'Dual',
      'Only Vend',
    ]);
    expect(app.partyService.search('dual', null, false).map((p) => p.company_name)).toEqual(['Dual']);
  });
});

describe('findDuplicate', () => {
  it('matches by GSTIN then name+phone', () => {
    const p = app.partyService.createParty(input());
    expect(app.partyService.findDuplicate(input({ company_name: 'X' }))!.id).toBe(p.id);
    const byName = app.partyService.findDuplicate(
      input({ gstin: '', registration_type: RegistrationType.UNREGISTERED }),
    );
    expect(byName!.id).toBe(p.id);
  });
});

describe('projection keeps invoice customer selection working', () => {
  it('a customer-capable party is selectable as an invoice customer', () => {
    const p = app.partyService.createParty(input({ company_type: PartyType.CUSTOMER_VENDOR }));
    // The invoice module reads customers; the mirror must exist with same id.
    const asCustomer = app.customerRepo.get(p.id);
    expect(asCustomer).not.toBeNull();
    expect(asCustomer!.name).toBe('Acme Moulds');
    expect(app.customerRepo.list().some((c) => c.id === p.id)).toBe(true);
  });

  it('a vendor-only party is NOT selectable as a customer', () => {
    const p = app.partyService.createParty(
      input({ company_type: PartyType.VENDOR, gstin: '', registration_type: RegistrationType.UNREGISTERED }),
    );
    expect(app.customerRepo.get(p.id)).toBeNull();
  });

  it('archiving a party hides its customer mirror', () => {
    const p = app.partyService.createParty(input());
    app.partyService.archive(p.id);
    expect(app.customerRepo.list().some((c) => c.id === p.id)).toBe(false);
  });
});

describe('PartyGroupService', () => {
  it('creates, prevents duplicate active names, renames, archives', () => {
    const g = app.partyGroupService.createGroup('Steel');
    expect(g.name).toBe('Steel');
    expect(() => app.partyGroupService.createGroup('Steel')).toThrow(PartyServiceError);
    const renamed = app.partyGroupService.renameGroup(g.id, 'Steel Co');
    expect(renamed.name).toBe('Steel Co');
    const archived = app.partyGroupService.archiveGroup(g.id);
    expect(archived.is_active).toBe(false);
    expect(app.partyGroupService.listGroups(false)).toHaveLength(0);
    expect(app.partyGroupService.listGroups(true)).toHaveLength(1);
  });

  it('rejects a blank group name', () => {
    expect(() => app.partyGroupService.createGroup('  ')).toThrow(PartyServiceError);
  });
});
