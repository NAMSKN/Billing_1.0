import type Decimal from 'decimal.js';

/**
 * Product / Service master (V2 Feature 2). A single record models one of three
 * item types. Faithful port of the Python `product_service` domain.
 *
 * The product stores tax/price DEFAULTS only — it never computes GST and never
 * rewrites a finalized invoice snapshot. The single calculation engine owns all
 * tax/total math (DECISIONS D-006). The exclusive sell_price / purchase_price
 * are authoritative for invoice-line prefill; the inclusive prices are stored
 * as entered, for display/reference only (never derived).
 *
 * Money is Decimal in the domain; conversion to integer paise happens at the
 * repository boundary. Percent/discount values and optional quantities are kept
 * as exact decimal strings / nullable Decimals.
 */

export const ItemType = {
  PRODUCT: 'PRODUCT',
  SERVICE: 'SERVICE',
  ADDITIONAL_CHARGES: 'ADDITIONAL_CHARGES',
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  PRODUCT: 'Product',
  SERVICE: 'Service',
  ADDITIONAL_CHARGES: 'Additional Charges',
};

/** Only a physical product carries stock configuration. */
export function tracksStock(t: ItemType): boolean {
  return t === ItemType.PRODUCT;
}

export const StockType = {
  NORMAL: 'NORMAL',
  BATCH: 'BATCH',
  SERIAL: 'SERIAL',
} as const;
export type StockType = (typeof StockType)[keyof typeof StockType];

export const STOCK_TYPE_LABEL: Record<StockType, string> = {
  NORMAL: 'Normal',
  BATCH: 'Batch',
  SERIAL: 'Serial No.',
};

export const DiscountType = {
  RUPEE: 'RUPEE',
  PERCENTAGE: 'PERCENTAGE',
} as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  RUPEE: 'Rupee',
  PERCENTAGE: 'Percentage',
};

export const CessType = {
  FIXED: 'FIXED',
  PER_UNIT: 'PER_UNIT',
} as const;
export type CessType = (typeof CessType)[keyof typeof CessType];

export const CESS_TYPE_LABEL: Record<CessType, string> = {
  FIXED: 'Fixed',
  PER_UNIT: 'Per Unit',
};

export interface ProductGroup {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  item_type: ItemType;

  // Product detail.
  name: string;
  note: string;
  barcode_no: string;
  hsn_sac_code: string;
  unit_of_measurement: string;

  // Tax defaults (engine calculates actual invoice tax).
  tax_rate: Decimal;
  cess_percent: Decimal;
  cess_type: CessType;
  cess_amount: Decimal;
  no_itc: boolean;

  // Pricing (both exclusive and inclusive kept, as entered).
  sell_price: Decimal;
  sell_price_incl_tax: Decimal;
  sale_discount_type: DiscountType;
  sale_discount_value: Decimal;
  purchase_price: Decimal;
  purchase_price_incl_tax: Decimal;
  purchase_discount_type: DiscountType;
  purchase_discount_value: Decimal;

  // Stock configuration (PRODUCT only; null qty when blank).
  stock_type: StockType;
  opening_qty: Decimal | null;
  low_stock_alert: Decimal | null;

  // Grouping / assets.
  product_group_id: string | null;
  image_asset_id: string | null;

  // Flags.
  is_manufactured: boolean;
  is_sellable: boolean;
  visible_on_documents: boolean;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}
