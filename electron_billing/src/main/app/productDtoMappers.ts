import { Money } from '@shared/domain/money';
import type { Product, ProductGroup } from '@shared/domain/product';
import type { ProductDto, ProductGroupDto } from '@shared/productDto';
import type { ProductInput } from './productService';

/** Product <-> wire DTO conversions. Money crosses as decimal strings. */

export function productToDto(p: Product, groupName?: string): ProductDto {
  return {
    id: p.id,
    item_type: p.item_type,
    name: p.name,
    note: p.note,
    barcode_no: p.barcode_no,
    hsn_sac_code: p.hsn_sac_code,
    unit_of_measurement: p.unit_of_measurement,
    tax_rate: p.tax_rate.toString(),
    cess_percent: p.cess_percent.toString(),
    cess_type: p.cess_type,
    cess_amount: p.cess_amount.toFixed(2),
    no_itc: p.no_itc,
    sell_price: p.sell_price.toFixed(2),
    sell_price_incl_tax: p.sell_price_incl_tax.toFixed(2),
    sale_discount_type: p.sale_discount_type,
    sale_discount_value: p.sale_discount_value.toString(),
    purchase_price: p.purchase_price.toFixed(2),
    purchase_price_incl_tax: p.purchase_price_incl_tax.toFixed(2),
    purchase_discount_type: p.purchase_discount_type,
    purchase_discount_value: p.purchase_discount_value.toString(),
    stock_type: p.stock_type,
    opening_qty: p.opening_qty ? p.opening_qty.toString() : null,
    low_stock_alert: p.low_stock_alert ? p.low_stock_alert.toString() : null,
    product_group_id: p.product_group_id,
    image_asset_id: p.image_asset_id,
    is_manufactured: p.is_manufactured,
    is_sellable: p.is_sellable,
    visible_on_documents: p.visible_on_documents,
    is_active: p.is_active,
    created_at: p.created_at,
    updated_at: p.updated_at,
    group_name: groupName,
  };
}

export function productInputFromDto(d: ProductDto): ProductInput {
  const dec = (s: string) => new Money(s || '0');
  return {
    item_type: d.item_type,
    name: d.name,
    note: d.note,
    barcode_no: d.barcode_no,
    hsn_sac_code: d.hsn_sac_code,
    unit_of_measurement: d.unit_of_measurement,
    tax_rate: dec(d.tax_rate),
    cess_percent: dec(d.cess_percent),
    cess_type: d.cess_type,
    cess_amount: dec(d.cess_amount),
    no_itc: d.no_itc,
    sell_price: dec(d.sell_price),
    sell_price_incl_tax: dec(d.sell_price_incl_tax),
    sale_discount_type: d.sale_discount_type,
    sale_discount_value: dec(d.sale_discount_value),
    purchase_price: dec(d.purchase_price),
    purchase_price_incl_tax: dec(d.purchase_price_incl_tax),
    purchase_discount_type: d.purchase_discount_type,
    purchase_discount_value: dec(d.purchase_discount_value),
    stock_type: d.stock_type,
    opening_qty: d.opening_qty ? new Money(d.opening_qty) : null,
    low_stock_alert: d.low_stock_alert ? new Money(d.low_stock_alert) : null,
    product_group_id: d.product_group_id,
    image_asset_id: d.image_asset_id,
    is_manufactured: d.is_manufactured,
    is_sellable: d.is_sellable,
    visible_on_documents: d.visible_on_documents,
  };
}

export function productGroupToDto(g: ProductGroup): ProductGroupDto {
  return { id: g.id, name: g.name, is_active: g.is_active };
}
