import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import type Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';
import {
  CessType,
  DiscountType,
  ItemType,
  StockType,
  tracksStock,
  type Product,
} from '@shared/domain/product';
import { validateProduct } from '@shared/domain/productValidation';
import { normalizeUnit } from '@shared/domain/units';
import type { ProductService, ProductInput } from '../app/productService';
import type { ProductGroupService } from '../app/productGroupService';
import { PCOL, PRODUCT_REQUIRED_IMPORT_HEADERS } from './excelColumns';

XLSX.set_fs(fs);

export type ProductImportAs = 'FILE' | 'PRODUCT' | 'SERVICE' | 'ADDITIONAL_CHARGES';
export type DuplicateResolution = 'UPDATE' | 'SKIP' | 'CREATE_NEW';

export interface ProductImportRow {
  row_number: number;
  data: ProductInput | null;
  errors: string[];
  duplicate_of_id: string | null;
  duplicate_of_name: string | null;
  resolution: DuplicateResolution;
}
export interface ProductImportPreview {
  header_errors: string[];
  rows: ProductImportRow[];
}
export interface ProductImportResult {
  created: number;
  updated: number;
  skipped: number;
}

const ITEM_ALIASES: Record<string, ItemType> = {
  product: ItemType.PRODUCT,
  products: ItemType.PRODUCT,
  service: ItemType.SERVICE,
  services: ItemType.SERVICE,
  'additional charges': ItemType.ADDITIONAL_CHARGES,
  'additional charge': ItemType.ADDITIONAL_CHARGES,
  additional_charges: ItemType.ADDITIONAL_CHARGES,
  'additional-charges': ItemType.ADDITIONAL_CHARGES,
  charges: ItemType.ADDITIONAL_CHARGES,
};
const STOCK_ALIASES: Record<string, StockType> = {
  normal: StockType.NORMAL,
  batch: StockType.BATCH,
  serial: StockType.SERIAL,
  'serial no': StockType.SERIAL,
  'serial no.': StockType.SERIAL,
  'serial number': StockType.SERIAL,
};
const DISCOUNT_ALIASES: Record<string, DiscountType> = {
  rupee: DiscountType.RUPEE,
  rs: DiscountType.RUPEE,
  inr: DiscountType.RUPEE,
  '\u20B9': DiscountType.RUPEE,
  percentage: DiscountType.PERCENTAGE,
  percent: DiscountType.PERCENTAGE,
  '%': DiscountType.PERCENTAGE,
};
const CESS_ALIASES: Record<string, CessType> = {
  fixed: CessType.FIXED,
  'per unit': CessType.PER_UNIT,
  per_unit: CessType.PER_UNIT,
  perunit: CessType.PER_UNIT,
};

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Tolerant numeric parse: strips ₹, %, commas, whitespace. */
function parseOptionalDecimal(value: unknown, label: string): [Decimal | null, string | null] {
  const raw = text(value);
  if (!raw) return [null, null];
  const cleaned = raw.replace(/[\u20B9%,\s]/g, '');
  if (!cleaned) return [null, null];
  try {
    const d = new Money(cleaned);
    if (!d.isFinite()) return [null, `${label} must be a number.`];
    return [d, null];
  } catch {
    return [null, `${label} must be a number.`];
  }
}

function parseBool(value: unknown): boolean {
  const t = text(value).toLowerCase();
  return t === 'yes' || t === 'y' || t === 'true' || t === '1';
}

function resolveItemType(value: unknown, importAs: ProductImportAs): [ItemType, string | null] {
  if (importAs !== 'FILE') return [importAs, null];
  const t = text(value);
  if (!t) return [ItemType.PRODUCT, null];
  const resolved = ITEM_ALIASES[t.toLowerCase()];
  if (!resolved) return [ItemType.PRODUCT, `Invalid Item Type: '${t}'.`];
  return [resolved, null];
}

function resolveEnum<T>(value: unknown, aliases: Record<string, T>, fallback: T): T {
  const t = text(value).toLowerCase();
  return t ? (aliases[t] ?? fallback) : fallback;
}

export class ProductExcelImporter {
  constructor(
    private readonly service: ProductService,
    private readonly groups: ProductGroupService,
  ) {}

  async buildPreview(filePath: string, importAs: ProductImportAs = 'FILE'): Promise<ProductImportPreview> {
    const preview: ProductImportPreview = { header_errors: [], rows: [] };
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
    });
    if (matrix.length === 0) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }
    const header = (matrix[0] as unknown[]).map((h) => text(h));
    const headerIndex = new Map<string, number>();
    header.forEach((name, i) => {
      if (name) headerIndex.set(name, i);
    });
    const missing = PRODUCT_REQUIRED_IMPORT_HEADERS.filter((h) => !headerIndex.has(h));
    if (missing.length) {
      preview.header_errors.push(`Missing required column(s): ${missing.join(', ')}`);
      return preview;
    }

    // Groups are auto-created during preview so a name resolves to an id.
    for (let r = 1; r < matrix.length; r++) {
      const cells = matrix[r] as unknown[];
      if (cells.every((v) => text(v) === '')) continue;
      const get = (col: string): unknown => {
        const idx = headerIndex.get(col);
        return idx === undefined ? null : (cells[idx] ?? null);
      };
      preview.rows.push(this.parseRow(r + 1, get, importAs));
    }
    return preview;
  }

  private parseRow(
    rowNumber: number,
    get: (col: string) => unknown,
    importAs: ProductImportAs,
  ): ProductImportRow {
    const errors: string[] = [];
    const [itemType, itemErr] = resolveItemType(get(PCOL.ITEM_TYPE), importAs);
    if (itemErr) errors.push(itemErr);

    const [tax, taxErr] = parseOptionalDecimal(get(PCOL.TAX), 'Tax');
    if (taxErr) errors.push(taxErr);
    const [cessPct, cpErr] = parseOptionalDecimal(get(PCOL.CESS_PERCENT), 'CESS %');
    if (cpErr) errors.push(cpErr);
    const [cessAmt, caErr] = parseOptionalDecimal(get(PCOL.CESS_AMOUNT), 'CESS Amount');
    if (caErr) errors.push(caErr);
    const [sell, sErr] = parseOptionalDecimal(get(PCOL.SELL_PRICE), 'Sell Price');
    if (sErr) errors.push(sErr);
    const [sellIncl, siErr] = parseOptionalDecimal(get(PCOL.SELL_PRICE_INCL), 'Sell Price (Incl. Tax)');
    if (siErr) errors.push(siErr);
    const [saleDisc, sdErr] = parseOptionalDecimal(get(PCOL.SALE_DISCOUNT), 'Sale Discount');
    if (sdErr) errors.push(sdErr);
    const [purch, pErr] = parseOptionalDecimal(get(PCOL.PURCHASE_PRICE), 'Purchase Price');
    if (pErr) errors.push(pErr);
    const [purchIncl, piErr] = parseOptionalDecimal(get(PCOL.PURCHASE_PRICE_INCL), 'Purchase Price (Incl. Tax)');
    if (piErr) errors.push(piErr);
    const [purchDisc, pdErr] = parseOptionalDecimal(get(PCOL.PURCHASE_DISCOUNT), 'Purchase Discount');
    if (pdErr) errors.push(pdErr);

    const stocks = tracksStock(itemType);
    let openingQty: Decimal | null = null;
    let lowStock: Decimal | null = null;
    if (stocks) {
      const [oq, oqErr] = parseOptionalDecimal(get(PCOL.AVAILABLE_QTY), 'Available Qty');
      if (oqErr) errors.push(oqErr);
      else openingQty = oq;
      const [ls, lsErr] = parseOptionalDecimal(get(PCOL.LOW_STOCK_ALERT), 'Low Stock Alert');
      if (lsErr) errors.push(lsErr);
      else lowStock = ls;
    }

    // Resolve/auto-create the product group by name.
    let groupId: string | null = null;
    const groupName = text(get(PCOL.PRODUCT_GROUP));
    if (groupName) {
      try {
        groupId = this.groups.ensureGroup(groupName).id;
      } catch {
        /* leave ungrouped on failure */
      }
    }

    const zero = new Money(0);
    const data: ProductInput = {
      item_type: itemType,
      name: text(get(PCOL.NAME)),
      note: text(get(PCOL.NOTE)),
      barcode_no: text(get(PCOL.BARCODE)),
      hsn_sac_code: text(get(PCOL.HSN_SAC)),
      unit_of_measurement: normalizeUnit(text(get(PCOL.UOM))) ?? '',
      tax_rate: tax ?? zero,
      cess_percent: cessPct ?? zero,
      cess_type: resolveEnum(get(PCOL.CESS_TYPE), CESS_ALIASES, CessType.FIXED),
      cess_amount: cessAmt ?? zero,
      no_itc: parseBool(get(PCOL.NO_ITC)),
      sell_price: sell ?? zero,
      sell_price_incl_tax: sellIncl ?? zero,
      sale_discount_type: resolveEnum(get(PCOL.SALE_DISCOUNT_TYPE), DISCOUNT_ALIASES, DiscountType.RUPEE),
      sale_discount_value: saleDisc ?? zero,
      purchase_price: purch ?? zero,
      purchase_price_incl_tax: purchIncl ?? zero,
      purchase_discount_type: resolveEnum(get(PCOL.PURCHASE_DISCOUNT_TYPE), DISCOUNT_ALIASES, DiscountType.RUPEE),
      purchase_discount_value: purchDisc ?? zero,
      stock_type: stocks ? resolveEnum(get(PCOL.STOCK_TYPE), STOCK_ALIASES, StockType.NORMAL) : StockType.NORMAL,
      opening_qty: openingQty,
      low_stock_alert: lowStock,
      product_group_id: groupId,
      image_asset_id: null,
      is_manufactured: parseBool(get(PCOL.MANUFACTURING)),
      // NON-SELLABLE column: "Yes" means not sellable.
      is_sellable: !parseBool(get(PCOL.NON_SELLABLE)),
      visible_on_documents: parseBool(get(PCOL.VISIBLE_ON_DOC)),
    };

    errors.push(...validateProduct(inputToProduct(data)));

    const row: ProductImportRow = {
      row_number: rowNumber,
      data: errors.length ? null : data,
      errors,
      duplicate_of_id: null,
      duplicate_of_name: null,
      resolution: 'CREATE_NEW',
    };
    if (!errors.length) {
      const dup = this.service.findDuplicate(data);
      if (dup) {
        row.duplicate_of_id = dup.id;
        row.duplicate_of_name = dup.name;
        row.resolution = 'SKIP';
      }
    }
    return row;
  }

  commit(preview: ProductImportPreview): ProductImportResult {
    const result: ProductImportResult = { created: 0, updated: 0, skipped: 0 };
    for (const row of preview.rows) {
      if (!row.data) continue;
      if (row.duplicate_of_id) {
        if (row.resolution === 'SKIP') {
          result.skipped++;
          continue;
        }
        if (row.resolution === 'UPDATE') {
          this.service.updateProduct(row.duplicate_of_id, row.data, true);
          result.updated++;
          continue;
        }
      }
      this.service.createProduct(row.data);
      result.created++;
    }
    return result;
  }
}

function inputToProduct(data: ProductInput): Product {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    ...data,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}
