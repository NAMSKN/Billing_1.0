import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { Money } from '@shared/domain/money';
import { CessType, DiscountType, ItemType, StockType } from '@shared/domain/product';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { StockExcel } from './stockExcel';
import type { ProductInput } from '../app/productService';

XLSX.set_fs(fs);

let app: Application;
let workDir: string;
let stockExcel: StockExcel;

beforeEach(() => {
  app = buildApplicationFromDb(connectMemory());
  workDir = mkdtempSync(join(tmpdir(), 'stock-xlsx-'));
  stockExcel = new StockExcel(app.productService, app.productGroupService, app.stockService);
});
afterEach(() => {
  app.close();
  rmSync(workDir, { recursive: true, force: true });
});

function product(name: string, openingQty: string): ProductInput {
  return {
    item_type: ItemType.PRODUCT,
    name,
    note: '',
    barcode_no: '',
    hsn_sac_code: '73181500',
    unit_of_measurement: 'nos',
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
    opening_qty: new Money(openingQty),
    low_stock_alert: null,
    product_group_id: null,
    image_asset_id: null,
    is_manufactured: false,
    is_sellable: true,
    visible_on_documents: false,
  };
}

async function writeXlsx(rows: Record<string, unknown>[]): Promise<string> {
  const header = ['NAME', 'BARCODE NO.', 'CURRENT STOCK', 'UPDATED STOCK'];
  const aoa = [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Stock');
  const path = join(workDir, 'in.xlsx');
  XLSX.writeFile(wb, path, { bookType: 'xlsx' });
  return path;
}

describe('stock export', () => {
  it('writes current stock for stock-tracking products', async () => {
    app.productService.createProduct(product('Bolt', '500'));
    app.stockService.backfillOpening();
    const out = join(workDir, 'out.xlsx');
    await stockExcel.export(out);
    const wb = XLSX.readFile(out);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
    const header = matrix[0] as string[];
    expect(header).toContain('CURRENT STOCK');
    expect(header).toContain('UPDATED STOCK');
    const row = matrix[1] as string[];
    expect(row).toContain('Bolt');
    expect(row).toContain('500');
  });
});

describe('stock import (absolute target -> delta)', () => {
  it('computes deltas and adjusts current stock', async () => {
    const p = app.productService.createProduct(product('Bolt', '500'));
    app.stockService.backfillOpening();

    const path = await writeXlsx([{ NAME: 'Bolt', 'UPDATED STOCK': '650' }]);
    const preview = stockExcel.buildPreview(path);
    expect(preview.header_errors).toEqual([]);
    expect(preview.rows[0].current).toBe('500');
    expect(preview.rows[0].target).toBe('650');
    expect(preview.rows[0].delta).toBe('150');
    expect(preview.adjust_count).toBe(1);

    const result = stockExcel.commit(preview);
    expect(result.adjusted).toBe(1);
    expect(app.stockService.currentStock(p.id).toString()).toBe('650');
  });

  it('marks unchanged when target equals current, and flags unknown products', async () => {
    app.productService.createProduct(product('Bolt', '100'));
    app.stockService.backfillOpening();
    const path = await writeXlsx([
      { NAME: 'Bolt', 'UPDATED STOCK': '100' }, // unchanged
      { NAME: 'Ghost', 'UPDATED STOCK': '5' }, // no match
    ]);
    const preview = stockExcel.buildPreview(path);
    expect(preview.unchanged_count).toBe(1);
    expect(preview.error_count).toBe(1);
    const result = stockExcel.commit(preview);
    expect(result.adjusted).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('rejects a negative target', async () => {
    app.productService.createProduct(product('Bolt', '100'));
    app.stockService.backfillOpening();
    const path = await writeXlsx([{ NAME: 'Bolt', 'UPDATED STOCK': '-5' }]);
    const preview = stockExcel.buildPreview(path);
    expect(preview.rows[0].error).toContain('non-negative');
  });

  it('header error when NAME is missing', async () => {
    const header = ['UPDATED STOCK'];
    const sheet = XLSX.utils.aoa_to_sheet([header, ['5']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Stock');
    const path = join(workDir, 'bad.xlsx');
    XLSX.writeFile(wb, path, { bookType: 'xlsx' });
    const preview = stockExcel.buildPreview(path);
    expect(preview.header_errors[0]).toContain('Missing required column');
  });
});
