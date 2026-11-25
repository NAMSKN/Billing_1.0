import type Decimal from 'decimal.js';
import { Money } from './money';
import { DiscountType, ItemType, type Product } from './product';
import { UNIT_LABEL, UNIT_VALUES, isUnit } from './units';

/**
 * Product validation (faithful port of Python `product_service/domain/rules.py`).
 * Returns human-readable error strings; empty means valid. HSN/SAC is NOT
 * enforced (invoice rules allow blank).
 */

const ZERO = new Money(0);
const HUNDRED = new Money(100);

function rejectNegative(errors: string[], label: string, value: Decimal): void {
  if (value.lessThan(ZERO)) errors.push(`${label} cannot be negative.`);
}

function validateDiscount(
  errors: string[],
  label: string,
  type: DiscountType,
  value: Decimal,
): void {
  if (value.lessThan(ZERO)) {
    errors.push(`${label} cannot be negative.`);
    return;
  }
  if (type === DiscountType.PERCENTAGE && value.greaterThan(HUNDRED)) {
    errors.push(`${label} percentage must be between 0 and 100.`);
  }
}

export function validateProduct(product: Product): string[] {
  const errors: string[] = [];

  if (!product.name.trim()) errors.push('Name is required.');

  const unit = product.unit_of_measurement.trim();
  if (product.item_type === ItemType.PRODUCT && !unit) {
    errors.push('Unit of Measurement is required for a Product.');
  } else if (unit && !isUnit(unit)) {
    const allowed = UNIT_VALUES.map((u) => UNIT_LABEL[u]).join(', ');
    errors.push(`Unit of Measurement must be one of: ${allowed}.`);
  }

  rejectNegative(errors, 'Tax rate', product.tax_rate);
  rejectNegative(errors, 'CESS %', product.cess_percent);
  rejectNegative(errors, 'CESS Amount', product.cess_amount);
  rejectNegative(errors, 'Sell Price', product.sell_price);
  rejectNegative(errors, 'Sell Price (Incl. Tax)', product.sell_price_incl_tax);
  rejectNegative(errors, 'Purchase Price', product.purchase_price);
  rejectNegative(errors, 'Purchase Price (Incl. Tax)', product.purchase_price_incl_tax);

  validateDiscount(errors, 'Sale Discount', product.sale_discount_type, product.sale_discount_value);
  validateDiscount(
    errors,
    'Purchase Discount',
    product.purchase_discount_type,
    product.purchase_discount_value,
  );

  if (product.opening_qty && product.opening_qty.lessThan(ZERO)) {
    errors.push('Opening Quantity cannot be negative.');
  }
  if (product.low_stock_alert && product.low_stock_alert.lessThan(ZERO)) {
    errors.push('Low Stock Alert cannot be negative.');
  }

  return errors;
}

/** Collapse whitespace + lowercase for name+type duplicate matching. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
