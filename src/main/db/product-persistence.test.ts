import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import {
  CessType,
  DiscountType,
  ItemType,
  StockType,
  type Product,
} from '@shared/domain/product';
import { connectMemory } from './connection';
import { SqliteProductRepository } from './productRepository';
import { SqliteProductGroupRepository } from './productGroupRepository';

let db: Database.Database;
beforeEach(() => {
  db = connectMemory();
});
afterEach(() => db.close());

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: uuidv4(),
    item_type: ItemType.PRODUCT,
    name: 'MS Hex Bolt M10',
    note: 'note',
    barcode_no: '890100001001',
    hsn_sac_code: '73181500',
    unit_of_measurement: 'nos',
    tax_rate: new Money('18'),
    cess_percent: new Money('0'),
    cess_type: CessType.PER_UNIT,
    cess_amount: new Money('0'),
    no_itc: false,
    sell_price: new Money('12.50'),
    sell_price_incl_tax: new Money('14.75'),
    sale_discount_type: DiscountType.PERCENTAGE,
    sale_discount_value: new Money('5'),
    purchase_price: new Money('8.50'),
    purchase_price_incl_tax: new Money('10.03'),
    purchase_discount_type: DiscountType.PERCENTAGE,
    purchase_discount_value: new Money('2'),
    stock_type: StockType.NORMAL,
    opening_qty: new Money('500'),
    low_stock_alert: new Money('50'),
    product_group_id: null,
    image_asset_id: null,
    is_manufactured: false,
    is_sellable: true,
    visible_on_documents: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('product round trip', () => {
  it('preserves prices (paise), tax/discount (decimal strings), nullable qty', () => {
    const repo = new SqliteProductRepository(db);
    const p = product();
    repo.save(p);
    const back = repo.get(p.id)!;
    expect(back.name).toBe('MS Hex Bolt M10');
    expect(back.sell_price.toFixed(2)).toBe('12.50');
    expect(back.sell_price_incl_tax.toFixed(2)).toBe('14.75');
    expect(back.tax_rate.toString()).toBe('18');
    expect(back.sale_discount_type).toBe(DiscountType.PERCENTAGE);
    expect(back.sale_discount_value.toString()).toBe('5');
    expect(back.cess_type).toBe(CessType.PER_UNIT);
    expect(back.opening_qty!.toString()).toBe('500');
    expect(back.low_stock_alert!.toString()).toBe('50');
  });

  it('nullable stock qty persists as null', () => {
    const repo = new SqliteProductRepository(db);
    const p = product({ opening_qty: null, low_stock_alert: null });
    repo.save(p);
    const back = repo.get(p.id)!;
    expect(back.opening_qty).toBeNull();
    expect(back.low_stock_alert).toBeNull();
  });
});

describe('filters and search', () => {
  it('filters by item type, sellable, archived; searches name/barcode/hsn', () => {
    const repo = new SqliteProductRepository(db);
    repo.save(product({ id: uuidv4(), name: 'Bolt', item_type: ItemType.PRODUCT, barcode_no: 'B1' }));
    repo.save(product({ id: uuidv4(), name: 'Consulting', item_type: ItemType.SERVICE, barcode_no: 'B2', unit_of_measurement: '' }));
    const nonSellable = product({ id: uuidv4(), name: 'Hidden', item_type: ItemType.PRODUCT, barcode_no: 'B3', is_sellable: false });
    repo.save(nonSellable);

    expect(repo.listAll({ itemType: ItemType.PRODUCT }).map((p) => p.name).sort()).toEqual(['Bolt', 'Hidden']);
    expect(repo.listAll({ itemType: ItemType.SERVICE }).map((p) => p.name)).toEqual(['Consulting']);
    expect(repo.listAll({ sellableOnly: true }).map((p) => p.name).sort()).toEqual(['Bolt', 'Consulting']);
    expect(repo.search('bolt', {}).map((p) => p.name)).toEqual(['Bolt']);
    expect(repo.search('73181500', {}).length).toBeGreaterThanOrEqual(1);
  });

  it('archive hides from default list', () => {
    const repo = new SqliteProductRepository(db);
    const p = product({ id: uuidv4() });
    repo.save(p);
    expect(repo.archive(p.id)).toBe(true);
    expect(repo.listAll({}).length).toBe(0);
    expect(repo.listAll({ includeArchived: true }).length).toBe(1);
  });
});

describe('duplicate lookups', () => {
  it('by barcode and by name+type', () => {
    const repo = new SqliteProductRepository(db);
    const p = product();
    repo.save(p);
    expect(repo.getByBarcode('890100001001')!.id).toBe(p.id);
    expect(repo.findByNameAndType('  ms   hex bolt m10 ', ItemType.PRODUCT)!.id).toBe(p.id);
    expect(repo.findByNameAndType('MS Hex Bolt M10', ItemType.SERVICE)).toBeNull();
  });
});

describe('product groups', () => {
  it('saves, unique among active, lists', () => {
    const repo = new SqliteProductGroupRepository(db);
    const g = { id: uuidv4(), name: 'Fasteners', is_active: true };
    repo.save(g);
    expect(repo.getByName('Fasteners')!.id).toBe(g.id);
    expect(repo.listAll(false)).toHaveLength(1);
  });
});
