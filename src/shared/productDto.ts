import type { CessType, DiscountType, ItemType, StockType } from './domain/product';

/**
 * Wire DTOs for the Product/Service master. Money/decimal values cross IPC as
 * decimal strings (never floats). The main process converts at its boundary.
 */

export interface ProductGroupDto {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ProductDto {
  id: string;
  item_type: ItemType;
  name: string;
  note: string;
  barcode_no: string;
  hsn_sac_code: string;
  unit_of_measurement: string;
  tax_rate: string;
  cess_percent: string;
  cess_type: CessType;
  cess_amount: string;
  no_itc: boolean;
  sell_price: string;
  sell_price_incl_tax: string;
  sale_discount_type: DiscountType;
  sale_discount_value: string;
  purchase_price: string;
  purchase_price_incl_tax: string;
  purchase_discount_type: DiscountType;
  purchase_discount_value: string;
  stock_type: StockType;
  opening_qty: string | null;
  low_stock_alert: string | null;
  product_group_id: string | null;
  image_asset_id: string | null;
  is_manufactured: boolean;
  is_sellable: boolean;
  visible_on_documents: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Derived, read-only display helpers for the list. */
  group_name?: string;
}

export interface ProductListRequest {
  itemType: 'ALL' | ItemType;
  includeArchived: boolean;
  groupId?: string | null;
  search?: string;
}

export type ProductImportAsDto = 'FILE' | 'PRODUCT' | 'SERVICE' | 'ADDITIONAL_CHARGES';

export interface ProductImportRowDto {
  row_number: number;
  name: string;
  errors: string[];
  duplicate_of_name: string | null;
  valid: boolean;
}
export interface ProductImportPreviewDto {
  token: string;
  header_errors: string[];
  rows: ProductImportRowDto[];
  valid_count: number;
  error_count: number;
  duplicate_count: number;
}
export interface ProductImportResultDto {
  created: number;
  updated: number;
  skipped: number;
}
export interface ProductExportRequest {
  scope: 'PRODUCTS' | 'SERVICES' | 'ADDITIONAL_CHARGES' | 'ALL';
  includeArchived: boolean;
}
