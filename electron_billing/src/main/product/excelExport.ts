import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import {
  CESS_TYPE_LABEL,
  DISCOUNT_TYPE_LABEL,
  ITEM_TYPE_LABEL,
  STOCK_TYPE_LABEL,
  ItemType,
  tracksStock,
  type Product,
} from '@shared/domain/product';
import type { ProductService } from '../app/productService';
import type { ProductGroupService } from '../app/productGroupService';
import { PCOL, PRODUCT_EXPORT_COLUMNS } from './excelColumns';

XLSX.set_fs(fs);

export type ProductExportScope = 'PRODUCTS' | 'SERVICES' | 'ADDITIONAL_CHARGES' | 'ALL';

/**
 * Product Excel exporter (SheetJS). Enum values written as labels; NON-SELLABLE
 * is the inversion of is_sellable; stock columns blank for non-PRODUCT items.
 */
export class ProductExcelExporter {
  constructor(
    private readonly products: ProductService,
    private readonly groups: ProductGroupService,
  ) {}

  private selectForScope(scope: ProductExportScope, includeArchived: boolean): Product[] {
    const all = this.products.list({ includeArchived });
    if (scope === 'ALL') return all;
    const target =
      scope === 'PRODUCTS'
        ? ItemType.PRODUCT
        : scope === 'SERVICES'
          ? ItemType.SERVICE
          : ItemType.ADDITIONAL_CHARGES;
    return all.filter((p) => p.item_type === target);
  }

  async export(scope: ProductExportScope, filePath: string, includeArchived: boolean): Promise<string> {
    const groupNames = new Map(this.groups.listGroups(true).map((g) => [g.id, g.name]));
    const rows = this.selectForScope(scope, includeArchived).map((p) => this.rowFor(p, groupNames));
    const sheet = XLSX.utils.json_to_sheet(rows, { header: PRODUCT_EXPORT_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Products & Services');
    XLSX.writeFile(wb, filePath, { bookType: 'xlsx' });
    return filePath;
  }

  private rowFor(p: Product, groupNames: Map<string, string>): Record<string, string> {
    const stocks = tracksStock(p.item_type);
    return {
      [PCOL.ITEM_TYPE]: ITEM_TYPE_LABEL[p.item_type],
      [PCOL.NAME]: p.name,
      [PCOL.NOTE]: p.note,
      [PCOL.BARCODE]: p.barcode_no,
      [PCOL.HSN_SAC]: p.hsn_sac_code,
      [PCOL.UOM]: p.unit_of_measurement,
      [PCOL.TAX]: p.tax_rate.toString(),
      [PCOL.CESS_PERCENT]: p.cess_percent.toString(),
      [PCOL.CESS_TYPE]: CESS_TYPE_LABEL[p.cess_type],
      [PCOL.CESS_AMOUNT]: p.cess_amount.toFixed(2),
      [PCOL.NO_ITC]: p.no_itc ? 'Yes' : 'No',
      [PCOL.SELL_PRICE]: p.sell_price.toFixed(2),
      [PCOL.SELL_PRICE_INCL]: p.sell_price_incl_tax.toFixed(2),
      [PCOL.SALE_DISCOUNT_TYPE]: DISCOUNT_TYPE_LABEL[p.sale_discount_type],
      [PCOL.SALE_DISCOUNT]: p.sale_discount_value.toString(),
      [PCOL.PURCHASE_PRICE]: p.purchase_price.toFixed(2),
      [PCOL.PURCHASE_PRICE_INCL]: p.purchase_price_incl_tax.toFixed(2),
      [PCOL.PURCHASE_DISCOUNT_TYPE]: DISCOUNT_TYPE_LABEL[p.purchase_discount_type],
      [PCOL.PURCHASE_DISCOUNT]: p.purchase_discount_value.toString(),
      [PCOL.STOCK_TYPE]: stocks ? STOCK_TYPE_LABEL[p.stock_type] : '',
      [PCOL.AVAILABLE_QTY]: stocks && p.opening_qty ? p.opening_qty.toString() : '',
      [PCOL.LOW_STOCK_ALERT]: stocks && p.low_stock_alert ? p.low_stock_alert.toString() : '',
      [PCOL.PRODUCT_GROUP]: p.product_group_id ? (groupNames.get(p.product_group_id) ?? '') : '',
      [PCOL.MANUFACTURING]: p.is_manufactured ? 'Yes' : 'No',
      [PCOL.NON_SELLABLE]: p.is_sellable ? 'No' : 'Yes',
      [PCOL.VISIBLE_ON_DOC]: p.visible_on_documents ? 'Yes' : 'No',
    };
  }
}
