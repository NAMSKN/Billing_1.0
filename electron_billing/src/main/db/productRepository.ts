import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';
import {
  CessType,
  DiscountType,
  ItemType,
  StockType,
  type Product,
} from '@shared/domain/product';
import { normalizeName } from '@shared/domain/productValidation';
import { money, toCanonicalUuid } from './mappers';

/**
 * Product repository (faithful port). Parameterized SQL only; participates in
 * the caller's transaction. Money as integer paise; tax/discount as decimal
 * strings; optional quantities nullable TEXT.
 */
export interface ProductRepository {
  get(id: string): Product | null;
  getByBarcode(barcode: string): Product | null;
  findByNameAndType(name: string, itemType: ItemType): Product | null;
  listAll(opts: ProductQuery): Product[];
  search(term: string, opts: ProductQuery): Product[];
  save(product: Product): void;
  archive(id: string): boolean;
}

export interface ProductQuery {
  itemType?: ItemType | null;
  includeArchived?: boolean;
  sellableOnly?: boolean;
  groupId?: string | null;
}

interface ProductRow {
  id: string;
  item_type: string;
  name: string;
  note: string;
  barcode_no: string;
  hsn_sac_code: string;
  unit_of_measurement: string;
  tax_rate: string;
  cess_percent: string;
  cess_type: string;
  cess_amount_paise: number;
  no_itc: number;
  sell_price_paise: number;
  sell_price_incl_tax_paise: number;
  sale_discount_type: string;
  sale_discount_value: string;
  purchase_price_paise: number;
  purchase_price_incl_tax_paise: number;
  purchase_discount_type: string;
  purchase_discount_value: string;
  stock_type: string;
  opening_qty: string | null;
  low_stock_alert: string | null;
  product_group_id: string | null;
  image_asset_id: string | null;
  is_manufactured: number;
  is_sellable: number;
  visible_on_documents: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: toCanonicalUuid(row.id),
    item_type: row.item_type as ItemType,
    name: row.name,
    note: row.note,
    barcode_no: row.barcode_no,
    hsn_sac_code: row.hsn_sac_code,
    unit_of_measurement: row.unit_of_measurement,
    tax_rate: new Money(row.tax_rate),
    cess_percent: new Money(row.cess_percent),
    cess_type: row.cess_type as CessType,
    cess_amount: money.fromPaise(row.cess_amount_paise),
    no_itc: row.no_itc === 1,
    sell_price: money.fromPaise(row.sell_price_paise),
    sell_price_incl_tax: money.fromPaise(row.sell_price_incl_tax_paise),
    sale_discount_type: row.sale_discount_type as DiscountType,
    sale_discount_value: new Money(row.sale_discount_value),
    purchase_price: money.fromPaise(row.purchase_price_paise),
    purchase_price_incl_tax: money.fromPaise(row.purchase_price_incl_tax_paise),
    purchase_discount_type: row.purchase_discount_type as DiscountType,
    purchase_discount_value: new Money(row.purchase_discount_value),
    stock_type: row.stock_type as StockType,
    opening_qty: row.opening_qty === null ? null : new Money(row.opening_qty),
    low_stock_alert: row.low_stock_alert === null ? null : new Money(row.low_stock_alert),
    product_group_id: row.product_group_id ? toCanonicalUuid(row.product_group_id) : null,
    image_asset_id: row.image_asset_id ? toCanonicalUuid(row.image_asset_id) : null,
    is_manufactured: row.is_manufactured === 1,
    is_sellable: row.is_sellable === 1,
    visible_on_documents: row.visible_on_documents === 1,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const COLUMNS = [
  'id',
  'item_type',
  'name',
  'note',
  'barcode_no',
  'hsn_sac_code',
  'unit_of_measurement',
  'tax_rate',
  'cess_percent',
  'cess_type',
  'cess_amount_paise',
  'no_itc',
  'sell_price_paise',
  'sell_price_incl_tax_paise',
  'sale_discount_type',
  'sale_discount_value',
  'purchase_price_paise',
  'purchase_price_incl_tax_paise',
  'purchase_discount_type',
  'purchase_discount_value',
  'stock_type',
  'opening_qty',
  'low_stock_alert',
  'product_group_id',
  'image_asset_id',
  'is_manufactured',
  'is_sellable',
  'visible_on_documents',
  'is_active',
  'created_at',
  'updated_at',
] as const;

export class SqliteProductRepository implements ProductRepository {
  constructor(private readonly db: Database.Database) {}

  private buildWhere(opts: ProductQuery, extra?: { clause: string; params: unknown[] }): {
    where: string;
    params: unknown[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.itemType) {
      clauses.push('item_type = ?');
      params.push(opts.itemType);
    }
    if (!opts.includeArchived) clauses.push('is_active = 1');
    if (opts.sellableOnly) clauses.push('is_sellable = 1');
    if (opts.groupId) {
      clauses.push('product_group_id = ?');
      params.push(toCanonicalUuid(opts.groupId));
    }
    if (extra) {
      clauses.push(extra.clause);
      params.push(...extra.params);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  get(id: string): Product | null {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(toCanonicalUuid(id)) as
      | ProductRow
      | undefined;
    return row ? rowToProduct(row) : null;
  }

  getByBarcode(barcode: string): Product | null {
    const clean = barcode.trim();
    if (!clean) return null;
    const row = this.db
      .prepare('SELECT * FROM products WHERE barcode_no = ? ORDER BY is_active DESC LIMIT 1')
      .get(clean) as ProductRow | undefined;
    return row ? rowToProduct(row) : null;
  }

  findByNameAndType(name: string, itemType: ItemType): Product | null {
    const rows = this.db
      .prepare('SELECT * FROM products WHERE item_type = ?')
      .all(itemType) as ProductRow[];
    const needle = normalizeName(name);
    const match = rows.find((r) => normalizeName(r.name) === needle);
    return match ? rowToProduct(match) : null;
  }

  listAll(opts: ProductQuery): Product[] {
    const { where, params } = this.buildWhere(opts);
    const rows = this.db
      .prepare(`SELECT * FROM products ${where} ORDER BY name COLLATE NOCASE ASC`)
      .all(...params) as ProductRow[];
    return rows.map(rowToProduct);
  }

  search(term: string, opts: ProductQuery): Product[] {
    const like = `%${term.trim()}%`;
    const { where, params } = this.buildWhere(opts, {
      clause: '(name LIKE ? OR barcode_no LIKE ? OR hsn_sac_code LIKE ?)',
      params: [like, like, like],
    });
    const rows = this.db
      .prepare(`SELECT * FROM products ${where} ORDER BY name COLLATE NOCASE ASC`)
      .all(...params) as ProductRow[];
    return rows.map(rowToProduct);
  }

  save(product: Product): void {
    const placeholders = COLUMNS.map((c) => `@${c}`).join(', ');
    this.db
      .prepare(`INSERT OR REPLACE INTO products (${COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .run({
        id: toCanonicalUuid(product.id),
        item_type: product.item_type,
        name: product.name,
        note: product.note,
        barcode_no: product.barcode_no,
        hsn_sac_code: product.hsn_sac_code,
        unit_of_measurement: product.unit_of_measurement,
        tax_rate: product.tax_rate.toString(),
        cess_percent: product.cess_percent.toString(),
        cess_type: product.cess_type,
        cess_amount_paise: money.toPaise(product.cess_amount),
        no_itc: product.no_itc ? 1 : 0,
        sell_price_paise: money.toPaise(product.sell_price),
        sell_price_incl_tax_paise: money.toPaise(product.sell_price_incl_tax),
        sale_discount_type: product.sale_discount_type,
        sale_discount_value: product.sale_discount_value.toString(),
        purchase_price_paise: money.toPaise(product.purchase_price),
        purchase_price_incl_tax_paise: money.toPaise(product.purchase_price_incl_tax),
        purchase_discount_type: product.purchase_discount_type,
        purchase_discount_value: product.purchase_discount_value.toString(),
        stock_type: product.stock_type,
        opening_qty: product.opening_qty ? product.opening_qty.toString() : null,
        low_stock_alert: product.low_stock_alert ? product.low_stock_alert.toString() : null,
        product_group_id: product.product_group_id ? toCanonicalUuid(product.product_group_id) : null,
        image_asset_id: product.image_asset_id ? toCanonicalUuid(product.image_asset_id) : null,
        is_manufactured: product.is_manufactured ? 1 : 0,
        is_sellable: product.is_sellable ? 1 : 0,
        visible_on_documents: product.visible_on_documents ? 1 : 0,
        is_active: product.is_active ? 1 : 0,
        created_at: product.created_at,
        updated_at: product.updated_at,
      });
  }

  archive(id: string): boolean {
    const info = this.db
      .prepare('UPDATE products SET is_active = 0 WHERE id = ?')
      .run(toCanonicalUuid(id));
    return info.changes > 0;
  }
}
