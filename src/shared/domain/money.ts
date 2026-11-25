import Decimal from 'decimal.js';

/**
 * Exact numeric primitives for money and related fixed-scale values.
 *
 * Faithful port of the Python `domain/money.py`. All monetary arithmetic uses
 * decimal.js configured for ROUND_HALF_UP, never JS floats (coding standard:
 * never use float for money). Scales (DECISIONS D-004/D-005):
 *   - Money: 2 dp, stored as integer paise (x100).
 *   - Quantity: 3 dp, stored as integer millis (x1000).
 *   - Percent (discount%, tax%): 2 dp, stored as integer hundredths (x100).
 *
 * Conversion to/from the scaled integers happens ONLY at the repository
 * boundary. The engine works in Decimal throughout.
 */

// Configure a dedicated Decimal constructor so global config elsewhere cannot
// change our rounding behaviour. ROUND_HALF_UP everywhere.
export const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP, precision: 40 });
export type MoneyValue = Decimal;

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;
export const PERCENT_SCALE = 2;

const MONEY_FACTOR = 100; // paise per rupee
const QUANTITY_FACTOR = 1000; // millis per unit
const PERCENT_FACTOR = 100; // hundredths per percent

/** Accepted exact-number inputs. JS `number` is rejected to avoid float drift. */
export type NumericInput = Decimal | string | number | bigint;

function reject_unsafe_number(value: NumericInput): void {
  // A JS number is allowed ONLY if it is a safe integer (e.g. paise counts).
  // Fractional numbers may already carry binary rounding error.
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new TypeError(
      'a non-integer JS number is not allowed for exact values; pass a Decimal or string',
    );
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError('unsafe integer; pass a Decimal or string');
  }
}

function toDecimal(value: NumericInput): Decimal {
  reject_unsafe_number(value);
  if (value instanceof Decimal) return value;
  return new Money(typeof value === 'bigint' ? value.toString() : value);
}

/** Quantize a value to 2 dp (money) using ROUND_HALF_UP. */
export function quantizeMoney(value: NumericInput): Decimal {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * Round to the nearest whole rupee (0 dp, ROUND_HALF_UP), returned as a 2 dp
 * Decimal. Used for invoice round-off.
 */
export function roundToRupee(value: NumericInput): Decimal {
  const whole = toDecimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return whole.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Quantize a quantity to 3 dp using ROUND_HALF_UP. */
export function quantizeQuantity(value: NumericInput): Decimal {
  return toDecimal(value).toDecimalPlaces(QUANTITY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Quantize a percent to 2 dp using ROUND_HALF_UP. */
export function quantizePercent(value: NumericInput): Decimal {
  return toDecimal(value).toDecimalPlaces(PERCENT_SCALE, Decimal.ROUND_HALF_UP);
}

// --- Repository-boundary converters (scaled integers) ---

export function toPaise(value: NumericInput): number {
  return quantizeMoney(value).times(MONEY_FACTOR).toNumber();
}

export function fromPaise(paise: number): Decimal {
  if (!Number.isInteger(paise)) throw new TypeError('paise must be an integer');
  return new Money(paise).dividedBy(MONEY_FACTOR).toDecimalPlaces(MONEY_SCALE);
}

export function toMillis(value: NumericInput): number {
  return quantizeQuantity(value).times(QUANTITY_FACTOR).toNumber();
}

export function fromMillis(millis: number): Decimal {
  if (!Number.isInteger(millis)) throw new TypeError('millis must be an integer');
  return new Money(millis).dividedBy(QUANTITY_FACTOR).toDecimalPlaces(QUANTITY_SCALE);
}

export function toHundredths(value: NumericInput): number {
  return quantizePercent(value).times(PERCENT_FACTOR).toNumber();
}

export function fromHundredths(hundredths: number): Decimal {
  if (!Number.isInteger(hundredths)) throw new TypeError('hundredths must be an integer');
  return new Money(hundredths).dividedBy(PERCENT_FACTOR).toDecimalPlaces(PERCENT_SCALE);
}

/** Sum a list of Decimals exactly, then quantize to money. */
export function sumMoney(values: Decimal[]): Decimal {
  return quantizeMoney(values.reduce((acc, v) => acc.plus(v), new Money(0)));
}

/** Format a rupee amount with Indian digit grouping and 2 dp (e.g. 1,50,000.00). */
export function formatMoney(amount: NumericInput): string {
  const quantized = quantizeMoney(amount);
  const negative = quantized.isNegative();
  const abs = quantized.abs().toFixed(MONEY_SCALE);
  const [whole, frac] = abs.split('.');
  const grouped = groupIndian(whole);
  const result = `${grouped}.${frac}`;
  return negative ? `-${result}` : result;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const parts: string[] = [];
  let rest = head;
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  parts.unshift(rest);
  return `${parts.join(',')},${tail}`;
}

/** Format a quantity, trimming trailing zeros (e.g. 16, 2.5). */
export function formatQuantity(quantity: NumericInput): string {
  const d = toDecimal(quantity);
  return d.toDecimalPlaces(QUANTITY_SCALE).toString();
}
