import Decimal from 'decimal.js';
import { quantizeMoney } from './money';

/**
 * Amount-in-words in the Indian numbering system (faithful behavioural port of
 * Python `domain/amount_words.py`, which wraps num2words en_IN).
 *
 * Format rules matched:
 *   - Prefix "INR", suffix "Only", title-cased words.
 *   - Indian grouping: lakh / crore.
 *   - With paise: "INR ... and NN Paise Only".
 *   - Negative amounts raise.
 * Examples:
 *   14490.00 -> "INR Fourteen Thousand Four Hundred Ninety Only"
 *   2210.40  -> "INR Two Thousand Two Hundred Ten and Forty Paise Only"
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** Convert 0..99 to words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
}

/** Convert 0..999 to words. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * Convert a non-negative integer to Indian-system words (crore/lakh/thousand).
 * Handles values up to 99,99,99,999 comfortably (well beyond invoice needs).
 */
function integerToWords(value: number): string {
  if (value === 0) return 'Zero';

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const hundred = value % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred > 0) parts.push(threeDigits(hundred));
  return parts.join(' ').trim();
}

/**
 * Produce the invoice amount-in-words string for a non-negative money value.
 */
export function amountInWords(amount: Decimal): string {
  const quantized = quantizeMoney(amount);
  if (quantized.isNegative()) {
    throw new RangeError('amount in words is not defined for negative values');
  }

  const rupees = quantized.floor().toNumber();
  const paise = quantized.minus(quantized.floor()).times(100).round().toNumber();

  const rupeeWords = integerToWords(rupees);

  if (paise > 0) {
    return `INR ${rupeeWords} and ${twoDigits(paise)} Paise Only`;
  }
  return `INR ${rupeeWords} Only`;
}
