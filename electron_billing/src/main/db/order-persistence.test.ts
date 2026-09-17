import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { TaxTreatment } from '@shared/domain/enums';
import {
  OrderLineItemType,
  OrderStatus,
  OrderType,
  emptyOrderParty,
  type Order,
  type OrderLine,
} from '@shared/domain/order';
import { connectMemory } from './connection';
import { SqliteOrderRepository } from './orderRepository';

/**
 * Order persistence: exact paise/millis round-trip, item_type + product_id
 * mapping, headers-only summaries, and draft cascade delete. Money compared as
 * exact fixed strings, never float-tolerant.
 */

let db: Database.Database;

beforeEach(() => {
  db = connectMemory();
});
afterEach(() => db.close());

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: uuidv4(),
    sequence: 0,
    item_type: OrderLineItemType.PRODUCT,
    product_id: null,
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

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: uuidv4(),
    order_number: null,
    order_type: OrderType.SALES_ORDER,
    status: OrderStatus.DRAFT,
    order_date: '2026-06-01',
    company_id: null,
    party_id: null,
    party: {
      ...emptyOrderParty(),
      name: 'DI-TECH MOULDS',
      gstin: '29ABCDE1234F1Z5',
      address: { line: '12 Area', state_name: 'Karnataka', state_code: '29', godown: '' },
    },
    ship_to: { line: '', state_name: '', state_code: '', godown: '' },
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    reverse_charge: false,
    delivery_mode: 'By Road',
    lines: [line(), line({ item_type: OrderLineItemType.SERVICE, description: 'Fitting service' })],
    totals: null,
    notes: 'note',
    terms: 'terms',
    document_note: 'internal remark',
    template_version: null,
    snapshot: null,
    converted_invoice_id: null,
    cancelled_at: '',
    cancel_reason: '',
    ...overrides,
  };
}

describe('order round trip', () => {
  it('preserves header, item_type, and exact line paise/millis', () => {
    const repo = new SqliteOrderRepository(db);
    const o = order();
    repo.save(o);
    const back = repo.get(o.id)!;

    expect(back.order_type).toBe(OrderType.SALES_ORDER);
    expect(back.delivery_mode).toBe('By Road');
    expect(back.party.name).toBe('DI-TECH MOULDS');
    expect(back.document_note).toBe('internal remark');
    expect(back.lines).toHaveLength(2);

    const l0 = back.lines[0];
    expect(l0.item_type).toBe(OrderLineItemType.PRODUCT);
    expect(l0.product_id).toBeNull();
    expect(l0.quantity.toString()).toBe('2.375');
    expect(l0.rate.toFixed(2)).toBe('1234.56');
    expect(l0.discount_percent.toFixed(2)).toBe('5.25');
    expect(l0.taxable_amount!.toFixed(2)).toBe('2777.51');
    expect(l0.note).toBe('handle with care');

    expect(back.lines[1].item_type).toBe(OrderLineItemType.SERVICE);
  });

  it('lists summaries as headers only (no line items)', () => {
    const repo = new SqliteOrderRepository(db);
    repo.save(order());
    repo.save(order());
    const summaries = repo.listSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].lines).toHaveLength(0);
  });

  it('deleteDraft removes a draft and cascades to line items', () => {
    const repo = new SqliteOrderRepository(db);
    const o = order();
    repo.save(o);
    repo.deleteDraft(o.id);
    expect(repo.get(o.id)).toBeNull();
    const items = db
      .prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?')
      .get(o.id) as { n: number };
    expect(items.n).toBe(0);
  });

  it('deleteDraft does NOT remove a confirmed order', () => {
    const repo = new SqliteOrderRepository(db);
    const o = order({ status: OrderStatus.CONFIRMED, order_number: 'SO/26-27/001' });
    repo.save(o);
    repo.deleteDraft(o.id);
    expect(repo.get(o.id)).not.toBeNull();
  });
});
