import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import { ItemType } from '@shared/domain/product';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { ProductExcelImporter } from './excelImport';
import { ProductExcelExporter } from './excelExport';
import { PCOL, PRODUCT_EXPORT_COLUMNS } from './excelColumns';

XLSX.set_fs(fs);

let db: Database.Database;
let app: Application;
let workDir: string;

beforeEach(() => {
  db = connectMemory();
  app = buildApplicationFromDb(db);
  workDir = mkdtempSync(join(tmpdir(), 'product-xlsx-'));
});
afterEach(() => {
  app.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** The exact 26-column header order the client's file uses. */
const DUMMY_HEADER = [
  'ITEM TYPE', 'NAME', 'PRODUCT NOTE', 'BARCODE NO.', 'HSN/SAC CODE', 'UNIT OF MEASUREMENT',
  'TAX', 'CESS %', 'CESS TYPE', 'CESS AMOUNT', 'NO-ITC', 'SELL PRICE', 'SELL PRICE (INCL. TAX)',
  'SALE DISCOUNT TYPE', 'SALE DISCOUNT', 'PURCHASE PRICE', 'PURCHASE PRICE (INCL. TAX)',
  'PURCHASE DISCOUNT TYPE', 'PURCHASE DISCOUNT', 'STOCK TYPE', 'AVAILABLE QTY', 'LOW STOCK ALERT',
  'PRODUCT GROUP', 'MANUFACTURING', 'NON-SELLABLE', 'VISIBLE ON DOCUMENT',
];

async function writeXlsx(headers: string[], rows: Record<string, unknown>[]): Promise<string> {
  const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Products & Services');
  const path = join(workDir, 'in.xlsx');
  XLSX.writeFile(wb, path, { bookType: 'xlsx' });
  return path;
}

describe('product Excel import', () => {
  it('imports the exact client header + rows (regression for the dummy file)', async () => {
    const path = await writeXlsx(DUMMY_HEADER, [
      {
        'ITEM TYPE': 'Product', NAME: 'MS Hex Bolt M10', 'HSN/SAC CODE': '73181500',
        'UNIT OF MEASUREMENT': 'PCS', TAX: '18', 'CESS TYPE': 'Per Unit', 'CESS AMOUNT': '0.00',
        'NO-ITC': 'No', 'SELL PRICE': '12.50', 'SELL PRICE (INCL. TAX)': '14.75',
        'SALE DISCOUNT TYPE': 'Percentage', 'SALE DISCOUNT': '5.00', 'PURCHASE PRICE': '8.50',
        'PURCHASE PRICE (INCL. TAX)': '10.03', 'PURCHASE DISCOUNT TYPE': 'Percentage',
        'PURCHASE DISCOUNT': '2.00', 'STOCK TYPE': 'Normal', 'AVAILABLE QTY': '500.00',
        'LOW STOCK ALERT': '50.00', 'PRODUCT GROUP': 'Fasteners', MANUFACTURING: 'No',
        'NON-SELLABLE': 'No', 'VISIBLE ON DOCUMENT': 'Yes',
      },
      {
        'ITEM TYPE': 'Service', NAME: 'Installation', TAX: '18',
        'SELL PRICE': '1,500.00', 'SALE DISCOUNT TYPE': 'Rupee', 'SALE DISCOUNT': '0',
        'NON-SELLABLE': 'No', 'VISIBLE ON DOCUMENT': 'Yes',
      },
    ]);
    const importer = new ProductExcelImporter(app.productService, app.productGroupService);
    const preview = await importer.buildPreview(path, 'FILE');
    expect(preview.header_errors).toEqual([]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every((r) => r.errors.length === 0)).toBe(true);

    const result = importer.commit(preview);
    expect(result.created).toBe(2);

    const bolt = app.productService.search('MS Hex Bolt M10')[0];
    expect(bolt.item_type).toBe(ItemType.PRODUCT);
    expect(bolt.sell_price.toFixed(2)).toBe('12.50');
    expect(bolt.opening_qty!.toString()).toBe('500');
    // Group auto-created.
    expect(app.productGroupService.listGroups(false).some((g) => g.name === 'Fasteners')).toBe(true);

    const svc = app.productService.search('Installation')[0];
    expect(svc.item_type).toBe(ItemType.SERVICE);
    expect(svc.sell_price.toFixed(2)).toBe('1500.00'); // comma tolerated
    expect(svc.opening_qty).toBeNull(); // service carries no stock
  });

  it('missing NAME column is a header error', async () => {
    const path = await writeXlsx(['TAX'], [{ TAX: '18' }]);
    const importer = new ProductExcelImporter(app.productService, app.productGroupService);
    const preview = await importer.buildPreview(path);
    expect(preview.header_errors[0]).toContain('Missing required column');
  });

  it('NON-SELLABLE=Yes makes the product non-sellable', async () => {
    const path = await writeXlsx([PCOL.NAME, PCOL.UOM, PCOL.NON_SELLABLE], [
      { NAME: 'Internal Item', 'UNIT OF MEASUREMENT': 'PCS', 'NON-SELLABLE': 'Yes' },
    ]);
    const importer = new ProductExcelImporter(app.productService, app.productGroupService);
    const preview = await importer.buildPreview(path, 'PRODUCT');
    importer.commit(preview);
    const p = app.productService.search('Internal Item')[0];
    expect(p.is_sellable).toBe(false);
  });

  it('detects a duplicate by barcode and skips', async () => {
    const path1 = await writeXlsx([PCOL.NAME, PCOL.UOM, PCOL.BARCODE], [
      { NAME: 'Bolt', 'UNIT OF MEASUREMENT': 'PCS', 'BARCODE NO.': 'BC1' },
    ]);
    const imp = new ProductExcelImporter(app.productService, app.productGroupService);
    imp.commit(await imp.buildPreview(path1, 'PRODUCT'));

    const path2 = await writeXlsx([PCOL.NAME, PCOL.UOM, PCOL.BARCODE], [
      { NAME: 'Bolt dup', 'UNIT OF MEASUREMENT': 'PCS', 'BARCODE NO.': 'BC1' },
    ]);
    const preview2 = await imp.buildPreview(path2, 'PRODUCT');
    expect(preview2.rows[0].duplicate_of_id).not.toBeNull();
    expect(imp.commit(preview2).skipped).toBe(1);
  });
});

describe('product Excel export', () => {
  it('exports the 26-column schema with NON-SELLABLE inversion', async () => {
    app.productService.createProduct({
      item_type: ItemType.PRODUCT,
      name: 'Exportable',
      note: '',
      barcode_no: '',
      hsn_sac_code: '1234',
      unit_of_measurement: 'PCS',
      tax_rate: (await import('@shared/domain/money')).Money('18'),
      cess_percent: (await import('@shared/domain/money')).Money('0'),
      cess_type: 'FIXED',
      cess_amount: (await import('@shared/domain/money')).Money('0'),
      no_itc: false,
      sell_price: (await import('@shared/domain/money')).Money('100'),
      sell_price_incl_tax: (await import('@shared/domain/money')).Money('118'),
      sale_discount_type: 'RUPEE',
      sale_discount_value: (await import('@shared/domain/money')).Money('0'),
      purchase_price: (await import('@shared/domain/money')).Money('80'),
      purchase_price_incl_tax: (await import('@shared/domain/money')).Money('94.4'),
      purchase_discount_type: 'RUPEE',
      purchase_discount_value: (await import('@shared/domain/money')).Money('0'),
      stock_type: 'NORMAL',
      opening_qty: (await import('@shared/domain/money')).Money('10'),
      low_stock_alert: null,
      product_group_id: null,
      image_asset_id: null,
      is_manufactured: false,
      is_sellable: false,
      visible_on_documents: true,
    });

    const exporter = new ProductExcelExporter(app.productService, app.productGroupService);
    const out = join(workDir, 'out.xlsx');
    await exporter.export('ALL', out, false);

    const wb = XLSX.readFile(out);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    expect(matrix[0] as string[]).toEqual(PRODUCT_EXPORT_COLUMNS);
    const row = matrix[1] as string[];
    expect(row).toContain('Exportable');
    // is_sellable=false -> NON-SELLABLE "Yes"
    const nonSellableIdx = PRODUCT_EXPORT_COLUMNS.indexOf(PCOL.NON_SELLABLE);
    expect(row[nonSellableIdx]).toBe('Yes');
  });
});
