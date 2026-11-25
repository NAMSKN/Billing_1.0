import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { InvoiceStatus, TaxTreatment } from '@shared/domain/enums';
import {
  ChallanDirection,
  ChallanType,
  emptyChallanParty,
  type Challan,
  type ChallanLine,
} from '@shared/domain/challan';
import { connectMemory } from './connection';
import { SqliteChallanRepository } from './challanRepository';

/**
 * Challan persistence: exact paise/millis round-trip (no precision loss
 * UI->domain->DB->domain), header + item mapping, and draft cascade delete.
 * Money is compared as exact fixed strings, never float-tolerant.
 */

let db: Database.Database;

beforeEach(() => {
  db = connectMemory();
});
afterEach(() => db.close());

function line(overrides: Partial<ChallanLine> = {}): ChallanLine {
  return {
    id: uuidv4(),
    sequence: 0,
    description: 'Mould base',
    hsn_sac: '998898',
    quantity: new Money('2.375'),
    unit: 'NOS',
    rate: new Money('1234.56'),
    discount_percent: new Money('5.25'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    note: 'handle with care',
    taxable_amount: new Money('2777.51'),
    cgst_amount: new Money('249.98'),
    sgst_amount: new Money('249.98'),
    igst_amount: new Money('0'),
    ...overrides,
  };
}

function challan(overrides: Partial<Challan> = {}): Challan {
  return {
    id: uuidv4(),
    challan_number: null,
    status: InvoiceStatus.DRAFT,
    direction: ChallanDirection.OUTWARD,
    challan_type: ChallanType.JOB_WORK,
    challan_date: '2026-06-01',
    company_id: null,
    party_id: null,
    party: {
      ...emptyChallanParty(),
      name: 'DI-TECH MOULDS',
      gstin: '29ABCDE1234F1Z5',
      address: { line: '12 Area', state_name: 'Karnataka', state_code: '29', godown: '' },
    },
    ship_to: { line: 'Godown 5', state_name: 'Karnataka', state_code: '29', godown: '' },
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    reverse_charge: false,
    reason_for_eway: 'Job work movement',
    delivery_mode: 'By Road',
    vehicle_no: 'MH12AB1234',
    source_order_number: 'SR/26-27/001',
    source_order_id: null,
    lines: [line()],
    totals: null,
    notes: 'note',
    terms: 'terms',
    document_note: 'internal remark',
    template_version: null,
    snapshot: null,
    cancelled_at: '',
    cancel_reason: '',
    ...overrides,
  };
}

describe('challan round trip', () => {
  it('preserves header, party, ship-to, and exact line paise/millis', () => {
    const repo = new SqliteChallanRepository(db);
    const c = challan();
    repo.save(c);
    const back = repo.get(c.id)!;

    expect(back.direction).toBe(ChallanDirection.OUTWARD);
    expect(back.challan_type).toBe(ChallanType.JOB_WORK);
    expect(back.reason_for_eway).toBe('Job work movement');
    expect(back.delivery_mode).toBe('By Road');
    expect(back.vehicle_no).toBe('MH12AB1234');
    expect(back.source_order_number).toBe('SR/26-27/001');
    expect(back.party.name).toBe('DI-TECH MOULDS');
    expect(back.party.gstin).toBe('29ABCDE1234F1Z5');
    expect(back.party.address.state_code).toBe('29');
    expect(back.ship_to.line).toBe('Godown 5');
    expect(back.document_note).toBe('internal remark');

    const l = back.lines[0];
    expect(l.quantity.toString()).toBe('2.375');
    expect(l.rate.toFixed(2)).toBe('1234.56');
    expect(l.discount_percent.toFixed(2)).toBe('5.25');
    expect(l.taxable_amount!.toFixed(2)).toBe('2777.51');
    expect(l.cgst_amount!.toFixed(2)).toBe('249.98');
    expect(l.note).toBe('handle with care');
  });

  it('lists summaries as headers only (no line items)', () => {
    const repo = new SqliteChallanRepository(db);
    repo.save(challan());
    repo.save(challan());
    const summaries = repo.listSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].lines).toHaveLength(0);
  });

  it('deleteDraft removes a draft and cascades to line items', () => {
    const repo = new SqliteChallanRepository(db);
    const c = challan();
    repo.save(c);
    repo.deleteDraft(c.id);
    expect(repo.get(c.id)).toBeNull();
    const items = db
      .prepare('SELECT COUNT(*) AS n FROM challan_items WHERE challan_id = ?')
      .get(c.id) as { n: number };
    expect(items.n).toBe(0);
  });

  it('deleteDraft does NOT remove a finalized challan', () => {
    const repo = new SqliteChallanRepository(db);
    const c = challan({ status: InvoiceStatus.FINALIZED, challan_number: 'DC/26-27/001' });
    repo.save(c);
    repo.deleteDraft(c.id);
    expect(repo.get(c.id)).not.toBeNull();
  });
});
