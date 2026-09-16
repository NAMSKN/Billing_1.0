import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';
import {
  BalanceType,
  PartyType,
  RegistrationType,
  isCustomerType,
  isVendorType,
  type Party,
  type PartyAddress,
} from '@shared/domain/party';
import { money, toCanonicalUuid } from './mappers';

/**
 * Party repository (faithful port of the Python SqlitePartyRepository).
 * Parameterized SQL only; participates in the caller's transaction and never
 * begins/commits its own. Money round-trips via integer paise; nullable
 * numerics (eway distance, credit limit, due days) persist as NULL when blank.
 */

export interface PartyRepository {
  get(id: string): Party | null;
  getByGstin(gstin: string): Party | null;
  findByNameAndPhone(name: string, phone: string): Party | null;
  listAll(partyType: PartyType | null, includeArchived: boolean): Party[];
  save(party: Party): void;
  archive(id: string): boolean;
}

interface PartyRow {
  id: string;
  company_type: string;
  company_name: string;
  contact_person: string;
  contact_no: string;
  email: string;
  registration_type: string;
  gstin: string;
  pan: string;
  bill_address1: string;
  bill_address2: string;
  bill_landmark: string;
  bill_country: string;
  bill_state: string;
  bill_state_code: string;
  bill_city: string;
  bill_pincode: string;
  has_shipping: number;
  ship_address1: string;
  ship_address2: string;
  ship_landmark: string;
  ship_country: string;
  ship_state: string;
  ship_state_code: string;
  ship_city: string;
  ship_pincode: string;
  distance_for_eway_bill_km: string | null;
  group_id: string | null;
  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;
  fax_no: string;
  website: string;
  credit_limit_paise: number | null;
  due_days: number | null;
  note: string;
  visible_on_documents: number;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  customer_balance_type: string;
  customer_balance_paise: number;
  vendor_balance_type: string;
  vendor_balance_paise: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function billingFromRow(row: PartyRow): PartyAddress {
  return {
    address1: row.bill_address1,
    address2: row.bill_address2,
    landmark: row.bill_landmark,
    country: row.bill_country,
    state: row.bill_state,
    state_code: row.bill_state_code,
    city: row.bill_city,
    pincode: row.bill_pincode,
  };
}

function shippingFromRow(row: PartyRow): PartyAddress | null {
  if (row.has_shipping !== 1) return null;
  return {
    address1: row.ship_address1,
    address2: row.ship_address2,
    landmark: row.ship_landmark,
    country: row.ship_country,
    state: row.ship_state,
    state_code: row.ship_state_code,
    city: row.ship_city,
    pincode: row.ship_pincode,
  };
}

function rowToParty(row: PartyRow): Party {
  return {
    id: toCanonicalUuid(row.id),
    company_type: row.company_type as PartyType,
    company_name: row.company_name,
    contact_person: row.contact_person,
    contact_no: row.contact_no,
    email: row.email,
    registration_type: row.registration_type as RegistrationType,
    gstin: row.gstin,
    pan: row.pan,
    billing_address: billingFromRow(row),
    shipping_address: shippingFromRow(row),
    distance_for_eway_bill_km:
      row.distance_for_eway_bill_km === null ? null : new Money(row.distance_for_eway_bill_km),
    group_id: row.group_id ? toCanonicalUuid(row.group_id) : null,
    bank_name: row.bank_name,
    bank_ifsc_code: row.bank_ifsc_code,
    bank_account_number: row.bank_account_number,
    fax_no: row.fax_no,
    website: row.website,
    credit_limit: row.credit_limit_paise === null ? null : money.fromPaise(row.credit_limit_paise),
    due_days: row.due_days,
    note: row.note,
    visible_on_documents: row.visible_on_documents === 1,
    custom_field_1: row.custom_field_1,
    custom_field_2: row.custom_field_2,
    custom_field_3: row.custom_field_3,
    customer_balance: {
      balance_type: row.customer_balance_type as BalanceType,
      amount: money.fromPaise(row.customer_balance_paise),
    },
    vendor_balance: {
      balance_type: row.vendor_balance_type as BalanceType,
      amount: money.fromPaise(row.vendor_balance_paise),
    },
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const COLUMNS = [
  'id',
  'company_type',
  'company_name',
  'contact_person',
  'contact_no',
  'email',
  'registration_type',
  'gstin',
  'pan',
  'bill_address1',
  'bill_address2',
  'bill_landmark',
  'bill_country',
  'bill_state',
  'bill_state_code',
  'bill_city',
  'bill_pincode',
  'has_shipping',
  'ship_address1',
  'ship_address2',
  'ship_landmark',
  'ship_country',
  'ship_state',
  'ship_state_code',
  'ship_city',
  'ship_pincode',
  'distance_for_eway_bill_km',
  'group_id',
  'bank_name',
  'bank_ifsc_code',
  'bank_account_number',
  'fax_no',
  'website',
  'credit_limit_paise',
  'due_days',
  'note',
  'visible_on_documents',
  'custom_field_1',
  'custom_field_2',
  'custom_field_3',
  'customer_balance_type',
  'customer_balance_paise',
  'vendor_balance_type',
  'vendor_balance_paise',
  'is_active',
  'created_at',
  'updated_at',
] as const;

export class SqlitePartyRepository implements PartyRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Party | null {
    const row = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(toCanonicalUuid(id)) as
      | PartyRow
      | undefined;
    return row ? rowToParty(row) : null;
  }

  getByGstin(gstin: string): Party | null {
    const clean = gstin.trim().toUpperCase();
    if (!clean) return null;
    // Prefer an active match.
    const row = this.db
      .prepare("SELECT * FROM parties WHERE gstin = ? ORDER BY is_active DESC LIMIT 1")
      .get(clean) as PartyRow | undefined;
    return row ? rowToParty(row) : null;
  }

  findByNameAndPhone(name: string, phone: string): Party | null {
    const rows = this.db.prepare('SELECT * FROM parties').all() as PartyRow[];
    const needleName = name.trim().toLowerCase().replace(/\s+/g, ' ');
    const needlePhone = phone.trim();
    const match = rows.find(
      (r) =>
        r.company_name.trim().toLowerCase().replace(/\s+/g, ' ') === needleName &&
        r.contact_no.trim() === needlePhone,
    );
    return match ? rowToParty(match) : null;
  }

  listAll(partyType: PartyType | null, includeArchived: boolean): Party[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (partyType === PartyType.CUSTOMER) {
      clauses.push("company_type IN ('CUSTOMER', 'CUSTOMER_VENDOR')");
    } else if (partyType === PartyType.VENDOR) {
      clauses.push("company_type IN ('VENDOR', 'CUSTOMER_VENDOR')");
    } else if (partyType === PartyType.CUSTOMER_VENDOR) {
      clauses.push('company_type = ?');
      params.push(PartyType.CUSTOMER_VENDOR);
    }
    if (!includeArchived) clauses.push('is_active = 1');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM parties ${where} ORDER BY company_name COLLATE NOCASE ASC`)
      .all(...params) as PartyRow[];
    return rows.map(rowToParty);
  }

  save(party: Party): void {
    const ship = party.shipping_address;
    const placeholders = COLUMNS.map((c) => `@${c}`).join(', ');
    this.db
      .prepare(`INSERT OR REPLACE INTO parties (${COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .run({
        id: toCanonicalUuid(party.id),
        company_type: party.company_type,
        company_name: party.company_name,
        contact_person: party.contact_person,
        contact_no: party.contact_no,
        email: party.email,
        registration_type: party.registration_type,
        gstin: party.gstin,
        pan: party.pan,
        bill_address1: party.billing_address.address1,
        bill_address2: party.billing_address.address2,
        bill_landmark: party.billing_address.landmark,
        bill_country: party.billing_address.country,
        bill_state: party.billing_address.state,
        bill_state_code: party.billing_address.state_code,
        bill_city: party.billing_address.city,
        bill_pincode: party.billing_address.pincode,
        has_shipping: ship ? 1 : 0,
        ship_address1: ship?.address1 ?? '',
        ship_address2: ship?.address2 ?? '',
        ship_landmark: ship?.landmark ?? '',
        ship_country: ship?.country ?? 'India',
        ship_state: ship?.state ?? '',
        ship_state_code: ship?.state_code ?? '',
        ship_city: ship?.city ?? '',
        ship_pincode: ship?.pincode ?? '',
        distance_for_eway_bill_km: party.distance_for_eway_bill_km
          ? party.distance_for_eway_bill_km.toString()
          : null,
        group_id: party.group_id ? toCanonicalUuid(party.group_id) : null,
        bank_name: party.bank_name,
        bank_ifsc_code: party.bank_ifsc_code,
        bank_account_number: party.bank_account_number,
        fax_no: party.fax_no,
        website: party.website,
        credit_limit_paise: party.credit_limit === null ? null : money.toPaise(party.credit_limit),
        due_days: party.due_days,
        note: party.note,
        visible_on_documents: party.visible_on_documents ? 1 : 0,
        custom_field_1: party.custom_field_1,
        custom_field_2: party.custom_field_2,
        custom_field_3: party.custom_field_3,
        customer_balance_type: party.customer_balance.balance_type,
        customer_balance_paise: money.toPaise(party.customer_balance.amount),
        vendor_balance_type: party.vendor_balance.balance_type,
        vendor_balance_paise: money.toPaise(party.vendor_balance.amount),
        is_active: party.is_active ? 1 : 0,
        created_at: party.created_at,
        updated_at: party.updated_at,
      });
  }

  archive(id: string): boolean {
    const info = this.db
      .prepare('UPDATE parties SET is_active = 0 WHERE id = ?')
      .run(toCanonicalUuid(id));
    return info.changes > 0;
  }
}

export { isCustomerType, isVendorType };
