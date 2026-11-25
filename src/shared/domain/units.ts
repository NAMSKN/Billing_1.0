/**
 * Canonical unit-of-measure vocabulary for products and document line items.
 *
 * The business standardises on exactly four units: millimetre, inch,
 * centimetre, and number-of-pieces. Units are stored and compared as the
 * canonical lowercase code (e.g. `nos`). A normaliser maps common legacy /
 * imported spellings (PCS, NOS, MM, INCHES…) onto the canonical set so existing
 * data and Excel imports resolve to a valid value.
 */

export const Unit = {
  MM: 'mm',
  INCH: 'inch',
  CM: 'cm',
  NOS: 'nos',
} as const;
export type Unit = (typeof Unit)[keyof typeof Unit];

/** All allowed unit codes, in display order. */
export const UNIT_VALUES: readonly Unit[] = [Unit.MM, Unit.INCH, Unit.CM, Unit.NOS];

/** Human-readable labels for dropdowns. */
export const UNIT_LABEL: Record<Unit, string> = {
  mm: 'mm (millimetre)',
  inch: 'inch',
  cm: 'cm (centimetre)',
  nos: 'nos (number)',
};

/** The default unit for new line items and products. */
export const DEFAULT_UNIT: Unit = Unit.NOS;

/** True if `value` is exactly one of the canonical unit codes. */
export function isUnit(value: string): value is Unit {
  return (UNIT_VALUES as readonly string[]).includes(value);
}

/**
 * Map a free-text / legacy unit spelling onto the canonical set. Returns null
 * when the input cannot be recognised (caller decides whether to reject or
 * fall back to the default). Case-insensitive; tolerates trailing plurals and
 * common synonyms.
 */
export function normalizeUnit(raw: string): Unit | null {
  const v = raw.trim().toLowerCase();
  if (v === '') return null;
  if (isUnit(v)) return v;
  switch (v) {
    case 'millimetre':
    case 'millimeter':
    case 'millimetres':
    case 'millimeters':
      return Unit.MM;
    case 'in':
    case 'inches':
    case '"':
      return Unit.INCH;
    case 'centimetre':
    case 'centimeter':
    case 'centimetres':
    case 'centimeters':
      return Unit.CM;
    case 'no':
    case 'no.':
    case 'nos.':
    case 'number':
    case 'numbers':
    case 'pcs':
    case 'pc':
    case 'piece':
    case 'pieces':
    case 'unit':
    case 'units':
    case 'qty':
      return Unit.NOS;
    default:
      return null;
  }
}
