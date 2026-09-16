import { describe, it, expect } from 'vitest';
import { Money } from './money';
import {
  ItemType,
  StockType,
  DiscountType,
  CessType,
  tracksStock,
  type Product,
} from './product';
import { validateProduct, normalizeName } from './productValidation';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    item_type: ItemType.PRODUCT,
    name: 'MS Hex Bolt M10',
    note: '',
    barcode_no: '',
    hsn_sac_code: '73181500',
    unit_of_measurement: 'PCS',
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
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('item type helpers', () => {
  it('only PRODUCT tracks stock', () => {
    expect(tracksStock(ItemType.PRODUCT)).toBe(true);
    expect(tracksStock(ItemType.SERVICE)).toBe(false);
    expect(tracksStock(ItemType.ADDITIONAL_CHARGES)).toBe(false);
  });
});

describe('validateProduct', () => {
  it('accepts a valid product', () => {
    expect(validateProduct(product())).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateProduct(product({ name: '' }))).toContain('Name is required.');
  });

  it('requires UoM for a product but not a service', () => {
    expect(validateProduct(product({ unit_of_measurement: '' }))).toContain(
      'Unit of Measurement is required for a Product.',
    );
    expect(
      validateProduct(product({ item_type: ItemType.SERVICE, unit_of_measurement: '' })),
    ).toEqual([]);
  });

  it('rejects negative prices', () => {
    expect(validateProduct(product({ sell_price: new Money('-1') }))).toContain(
      'Sell Price cannot be negative.',
    );
  });

  it('rejects a percentage discount above 100', () => {
    const errs = validateProduct(
      product({ sale_discount_type: DiscountType.PERCENTAGE, sale_discount_value: new Money('150') }),
    );
    expect(errs.some((e) => e.includes('Sale Discount percentage'))).toBe(true);
  });

  it('rejects negative stock quantities', () => {
    expect(validateProduct(product({ opening_qty: new Money('-5') }))).toContain(
      'Opening Quantity cannot be negative.',
    );
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeName('  MS   Hex  Bolt ')).toBe('ms hex bolt');
  });
});
