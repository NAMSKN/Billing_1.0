import Decimal from 'decimal.js';
import {
  fromHundredths,
  fromMillis,
  fromPaise,
  toHundredths,
  toMillis,
  toPaise,
} from '@shared/domain/money';

/**
 * Conversions at the repository boundary (DECISIONS D-004/D-005/D-024):
 *   - UUIDs <-> canonical lowercase hyphenated TEXT (validated).
 *   - Money <-> integer paise, quantity <-> millis, percent <-> hundredths.
 *   - Booleans <-> INTEGER 0/1.
 * Domain code works in Decimal/UUID-string; only these helpers touch scaled
 * integers.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validate + normalize a UUID to canonical lowercase form. */
export function toCanonicalUuid(value: string): string {
  const lower = value.toLowerCase();
  if (!UUID_RE.test(lower)) {
    throw new Error(`invalid UUID: ${value}`);
  }
  return lower;
}

/** Parse a UUID from the DB, validating format at the boundary. */
export function parseUuid(value: string | null): string | null {
  if (value === null) return null;
  return toCanonicalUuid(value);
}

export const money = { toPaise, fromPaise };
export const quantity = { toMillis, fromMillis };
export const percent = { toHundredths, fromHundredths };

export function boolToInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function intToBool(value: number): boolean {
  return value === 1;
}

/** Convert a nullable paise column to a Decimal or null. */
export function paiseToDecimalOrNull(paise: number | null): Decimal | null {
  return paise === null ? null : fromPaise(paise);
}
