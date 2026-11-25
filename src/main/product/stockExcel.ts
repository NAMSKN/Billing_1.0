import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import type Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';
import { tracksStock } from '@shared/domain/product';
import type { ProductService } from '../app/productService';
import type { ProductGroupService } from '../app/productGroupService';
import type { StockService } from '../app/stockService';

XLSX.set_fs(fs);

/**
 * Bulk stock Excel (matches the "Bulk Edit Product Stock" screen). Export writes
 * current derived stock; import reads an absolute-target "Updated Stock" column,
 * computes the delta against current stock, and posts ADJUSTMENT movements. Only
 * stock-tracking products participate.
 */

const SCOL = {
  NAME: 'NAME',
  BARCODE: 'BARCODE NO.',
  HSN: 'HSN/SAC CODE',
  GROUP: 'PRODUCT GROUP',
  UOM: 'UNIT OF MEASUREMENT',
  CURRENT: 'CURRENT STOCK',
  UPDATED: 'UPDATED STOCK',
} as const;

const EXPORT_COLUMNS = [SCOL.NAME, SCOL.BARCODE, SCOL.HSN, SCOL.GROUP, SCOL.UOM, SCOL.CURRENT, SCOL.UPDATED];
const REQUIRED = [SCOL.NAME];

export interface StockImportRow {
  row_number: number;
  product_id: string | null;
  name: string;
  current: string;
  target: string | null;
  delta: string | null;
  error: string | null;
}
export interface StockImportPreview {
  header_errors: string[];
  rows: StockImportRow[];
  adjust_count: number;
  unchanged_count: number;
  error_count: number;
}
export interface StockImportResult {
  adjusted: number;
  unchanged: number;
  skipped: number;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
function parseQty(v: unknown): Decimal | null {
  const raw = text(v).replace(/[,\s]/g, '');
  if (!raw) return null;
  try {
    const d = new Money(raw);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export class StockExcel {
  constructor(
    private readonly products: ProductService,
    private readonly groups: ProductGroupService,
    private readonly stock: StockService,
  ) {}

  async export(filePath: string): Promise<string> {
    const groupNames = new Map(this.groups.listGroups(true).map((g) => [g.id, g.name]));
    const stockMap = this.stock.currentStockMap();
    const rows = this.products
      .list({})
      .filter((p) => tracksStock(p.item_type))
      .map((p) => ({
        [SCOL.NAME]: p.name,
        [SCOL.BARCODE]: p.barcode_no,
        [SCOL.HSN]: p.hsn_sac_code,
        [SCOL.GROUP]: p.product_group_id ? (groupNames.get(p.product_group_id) ?? '') : '',
        [SCOL.UOM]: p.unit_of_measurement,
        [SCOL.CURRENT]: (stockMap.get(p.id) ?? new Money(0)).toString(),
        // Blank so the user fills the target; export doubles as a template.
        [SCOL.UPDATED]: '',
      }));
    const sheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Stock');
    XLSX.writeFile(wb, filePath, { bookType: 'xlsx' });
    return filePath;
  }

  buildPreview(filePath: string): StockImportPreview {
    const preview: StockImportPreview = {
      header_errors: [],
      rows: [],
      adjust_count: 0,
      unchanged_count: 0,
      error_count: 0,
    };
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false, raw: false });
    if (matrix.length === 0) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }
    const header = (matrix[0] as unknown[]).map(text);
    const idx = new Map<string, number>();
    header.forEach((h, i) => h && idx.set(h, i));
    const missing = REQUIRED.filter((h) => !idx.has(h));
    if (missing.length) {
      preview.header_errors.push(`Missing required column(s): ${missing.join(', ')}`);
      return preview;
    }
    if (!idx.has(SCOL.UPDATED)) {
      preview.header_errors.push(`Missing the "${SCOL.UPDATED}" column (the target stock to set).`);
      return preview;
    }

    // Match by barcode first (if present), else by name.
    for (let r = 1; r < matrix.length; r++) {
      const cells = matrix[r] as unknown[];
      if (cells.every((v) => text(v) === '')) continue;
      const get = (col: string) => {
        const i = idx.get(col);
        return i === undefined ? null : (cells[i] ?? null);
      };
      const name = text(get(SCOL.NAME));
      const barcode = text(get(SCOL.BARCODE));
      const targetRaw = get(SCOL.UPDATED);

      const row: StockImportRow = {
        row_number: r + 1,
        product_id: null,
        name,
        current: '0',
        target: null,
        delta: null,
        error: null,
      };

      const product =
        (barcode ? this.products.list({ includeArchived: true }).find((p) => p.barcode_no === barcode) : undefined) ??
        this.products.list({ includeArchived: true }).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());

      if (!product) {
        row.error = 'No matching product found.';
      } else if (!tracksStock(product.item_type)) {
        row.error = 'Item does not track stock.';
      } else {
        row.product_id = product.id;
        const current = this.stock.currentStock(product.id);
        row.current = current.toString();
        if (text(targetRaw) === '') {
          row.error = 'No target stock provided.';
        } else {
          const target = parseQty(targetRaw);
          if (!target || target.lessThan(new Money(0))) {
            row.error = 'Updated Stock must be a non-negative number.';
          } else {
            row.target = target.toString();
            row.delta = target.minus(current).toString();
          }
        }
      }

      if (row.error) preview.error_count += 1;
      else if (row.delta === '0') preview.unchanged_count += 1;
      else preview.adjust_count += 1;

      preview.rows.push(row);
    }
    return preview;
  }

  commit(preview: StockImportPreview): StockImportResult {
    const result: StockImportResult = { adjusted: 0, unchanged: 0, skipped: 0 };
    const entries = preview.rows
      .filter((r) => !r.error && r.product_id && r.target !== null)
      .map((r) => ({ productId: r.product_id as string, finalQty: new Money(r.target as string), remarks: 'Bulk stock update' }));

    // Apply all adjustments atomically.
    const applied = this.stock.adjustMany(entries);
    for (const a of applied) {
      if (a.changed) result.adjusted += 1;
      else result.unchanged += 1;
    }
    result.skipped = preview.rows.filter((r) => r.error).length;
    return result;
  }
}
