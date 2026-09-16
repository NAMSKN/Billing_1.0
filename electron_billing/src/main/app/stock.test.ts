import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Money } from '@shared/domain/money';
import { CessType, DiscountType, ItemType, StockType } from '@shared/domain/product';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import type { ProductInput } from './productService';

let app: Application;
beforeEach(() => {
  app = buildApplicationFromDb(connectMemory());
});
afterEach(() => app.close());

function product(name: string, openingQty: string | null, lowStock: string | null = null): ProductInput {
  return {
    item_type: ItemType.PRODUCT,
    name,
    note: '',
    barcode_no: '',
    hsn_sac_code: '73181500',
    unit_of_measurement: 'PCS',
    tax_rate: new Money('18'),
    cess_percent: new Money('0'),
    cess_type: CessType.FIXED,
    cess_amount: new Money('0'),
    no_itc: false,
    sell_price: new Money('100'),
    sell_price_incl_tax: new Money('118'),
    sale_discount_type: DiscountType.RUPEE,
    sale_discount_value: new Money('0'),
    purchase_price: new Money('0'),
    purchase_price_incl_tax: new Money('0'),
    purchase_discount_type: DiscountType.RUPEE,
    purchase_discount_value: new Money('0'),
    stock_type: StockType.NORMAL,
    opening_qty: openingQty === null ? null : new Money(openingQty),
    low_stock_alert: lowStock === null ? null : new Money(lowStock),
    product_group_id: null,
    image_asset_id: null,
    is_manufactured: false,
    is_sellable: true,
    visible_on_documents: false,
  };
}

describe('opening backfill', () => {
  it('creates one OPENING movement per product with opening_qty', () => {
    // createProduct writes the product; backfill runs at composition, so we
    // call it again after creating (idempotent) to pick up the new product.
    const p = app.productService.createProduct(product('Bolt', '500'));
    app.productService.createProduct(product('Service-ish', null)); // no opening -> no movement
    const added = app.stockService.backfillOpening();
    expect(added).toBe(1);
    expect(app.stockService.currentStock(p.id).toString()).toBe('500');
    // Running again adds nothing (idempotent).
    expect(app.stockService.backfillOpening()).toBe(0);
  });
});

describe('adjustToFinal (absolute target)', () => {
  it('computes delta = final - current and posts one ADJUSTMENT', () => {
    const p = app.productService.createProduct(product('Bolt', '500'));
    app.stockService.backfillOpening();
    expect(app.stockService.currentStock(p.id).toString()).toBe('500');

    // Target 650 -> +150.
    const r1 = app.stockService.adjustToFinal(p.id, new Money('650'), 'restock');
    expect(r1.delta.toString()).toBe('150');
    expect(r1.changed).toBe(true);
    expect(app.stockService.currentStock(p.id).toString()).toBe('650');

    // Target 600 -> -50.
    const r2 = app.stockService.adjustToFinal(p.id, new Money('600'), 'shrinkage');
    expect(r2.delta.toString()).toBe('-50');
    expect(app.stockService.currentStock(p.id).toString()).toBe('600');

    // Same value -> no movement.
    const r3 = app.stockService.adjustToFinal(p.id, new Money('600'), 'noop');
    expect(r3.changed).toBe(false);
  });

  it('preserves fractional (millis) quantities exactly', () => {
    const p = app.productService.createProduct(product('Wire', '12.5'));
    app.stockService.backfillOpening();
    app.stockService.adjustToFinal(p.id, new Money('37.125'), 'spool');
    expect(app.stockService.currentStock(p.id).toString()).toBe('37.125');
  });
});

describe('movement history', () => {
  it('lists movements oldest-first with opening + adjustments', () => {
    const p = app.productService.createProduct(product('Bolt', '100'));
    app.stockService.backfillOpening();
    app.stockService.adjustToFinal(p.id, new Money('120'), 'in');
    const log = app.stockService.movementsFor(p.id);
    expect(log).toHaveLength(2);
    expect(log[0].reason).toBe('OPENING');
    expect(log[0].delta_millis).toBe(100000);
    expect(log[1].reason).toBe('ADJUSTMENT');
    expect(log[1].delta_millis).toBe(20000);
    expect(log[1].remarks).toBe('in');
  });
});

describe('currentStockMap bulk', () => {
  it('returns derived stock for all products', () => {
    const a = app.productService.createProduct(product('A', '10'));
    const b = app.productService.createProduct(product('B', '20'));
    app.stockService.backfillOpening();
    const map = app.stockService.currentStockMap();
    expect(map.get(a.id)!.toString()).toBe('10');
    expect(map.get(b.id)!.toString()).toBe('20');
  });
});
