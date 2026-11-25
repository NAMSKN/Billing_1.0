import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';
import { CessType, DiscountType, ItemType, StockType } from '@shared/domain/product';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import {
  ProductValidationError,
  DuplicateProductError,
  type ProductInput,
} from './productService';
import { ProductGroupServiceError } from './productGroupService';

let db: Database.Database;
let app: Application;
beforeEach(() => {
  db = connectMemory();
  app = buildApplicationFromDb(db);
});
afterEach(() => app.close());

function input(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    item_type: ItemType.PRODUCT,
    name: 'MS Hex Bolt M10',
    note: '',
    barcode_no: '890100001001',
    hsn_sac_code: '73181500',
    unit_of_measurement: 'nos',
    tax_rate: new Money('18'),
    cess_percent: new Money('0'),
    cess_type: CessType.FIXED,
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
    ...overrides,
  };
}

describe('ProductService create/update', () => {
  it('creates and rehydrates a product', () => {
    const p = app.productService.createProduct(input());
    const back = app.productService.get(p.id)!;
    expect(back.name).toBe('MS Hex Bolt M10');
    expect(back.sell_price.toFixed(2)).toBe('12.50');
  });

  it('rejects an invalid product', () => {
    expect(() => app.productService.createProduct(input({ name: '' }))).toThrow(
      ProductValidationError,
    );
  });

  it('rejects a duplicate barcode', () => {
    app.productService.createProduct(input());
    expect(() => app.productService.createProduct(input({ name: 'Other' }))).toThrow(
      DuplicateProductError,
    );
  });

  it('normalizes away stock config for a SERVICE', () => {
    const p = app.productService.createProduct(
      input({
        item_type: ItemType.SERVICE,
        unit_of_measurement: '',
        barcode_no: '',
        stock_type: StockType.SERIAL,
        opening_qty: new Money('99'),
        low_stock_alert: new Money('9'),
      }),
    );
    expect(p.stock_type).toBe(StockType.NORMAL);
    expect(p.opening_qty).toBeNull();
    expect(p.low_stock_alert).toBeNull();
  });
});

describe('filters and sellable', () => {
  it('sellableProducts excludes archived and non-sellable', () => {
    app.productService.createProduct(input({ barcode_no: 'A', name: 'Sellable' }));
    app.productService.createProduct(input({ barcode_no: 'B', name: 'Hidden', is_sellable: false }));
    const archived = app.productService.createProduct(input({ barcode_no: 'C', name: 'Archived' }));
    app.productService.archive(archived.id);

    const sellable = app.productService.sellableProducts();
    expect(sellable.map((p) => p.name)).toEqual(['Sellable']);
  });

  it('search matches name/barcode/hsn', () => {
    app.productService.createProduct(input({ barcode_no: 'Z9', name: 'Widget' }));
    expect(app.productService.search('widget').map((p) => p.name)).toEqual(['Widget']);
    expect(app.productService.search('Z9').map((p) => p.name)).toEqual(['Widget']);
  });
});

describe('ProductGroupService', () => {
  it('creates, prevents duplicate active names, ensureGroup reuses, archives', () => {
    const g = app.productGroupService.createGroup('Fasteners');
    expect(() => app.productGroupService.createGroup('Fasteners')).toThrow(ProductGroupServiceError);
    expect(app.productGroupService.ensureGroup('Fasteners').id).toBe(g.id);
    expect(app.productGroupService.ensureGroup('New Group').name).toBe('New Group');
    app.productGroupService.archiveGroup(g.id);
    expect(app.productGroupService.listGroups(false).some((x) => x.id === g.id)).toBe(false);
  });
});
