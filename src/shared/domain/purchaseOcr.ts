/**
 * Purchase Bill & Invoice OCR Parsing Heuristics.
 * Extracts Supplier GSTIN, Invoice Number, Date, Grand Total, Tax Breakdown,
 * and line items from OCR raw text.
 */

export const GSTIN_REGEX = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;

export const DATE_REGEXES = [
  /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/,
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})\b/i,
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseDateFrom(text: string): string {
  for (const re of DATE_REGEXES) {
    const m = text.match(re);
    if (!m) continue;
    let y = 0, mo = 0, d = 0;
    if (/^\d/.test(m[2])) {
      // Numeric month -> DD-MM-YYYY (India standard)
      d = Number(m[1]);
      mo = Number(m[2]);
      y = Number(m[3]);
    } else {
      d = Number(m[1]);
      mo = MONTHS[m[2].slice(0, 3).toLowerCase()] || 0;
      y = Number(m[3]);
    }
    if (y < 100) y = 2000 + y;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) continue;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
}

export function parseInvoiceNumber(text: string): string {
  const m = text.match(/(?:invoice|bill|inv|voucher)\s*(?:no\.?|#|number|num)\s*[:\-]?\s*([A-Za-z0-9/-]{3,25})/i);
  return m ? m[1].trim() : '';
}

export function parseSupplierName(text: string): string {
  const gstinIdx = text.search(GSTIN_REGEX);
  const above = gstinIdx > 0 ? text.slice(0, gstinIdx) : text;
  const lines = above
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^gstin\b/i.test(l) && !/^tax\s+invoice\b/i.test(l));

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length < 4 || line.length > 80) continue;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) continue;
    const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (upper >= 0.5) return line;
  }
  return '';
}

export function parseGrandTotal(text: string): number {
  const patterns = [
    /grand\s*total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /(?:amount|amt)\s+payable[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /(?:invoice\s+)?total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    /net\s+(?:amount|payable)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return 0;
}

export interface TaxBreakdown {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  roundOff: number;
}

export function parseTaxBreakdown(text: string): TaxBreakdown {
  const out: TaxBreakdown = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundOff: 0 };
  const num = (m: RegExpMatchArray | null) => {
    if (!m) return 0;
    const n = Number(m[m.length - 1].replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };

  const patterns: Record<keyof TaxBreakdown, RegExp[]> = {
    taxableValue: [
      /(?:taxable\s+(?:value|amount))[^0-9-]{0,15}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
      /(?:sub\s?total|subtotal)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    cgst: [
      /\bcgst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    sgst: [
      /\b(?:sgst|utgst)[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    igst: [
      /\bigst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    cess: [
      /\bcess[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ],
    roundOff: [
      /(?:round\s*(?:off|ing))[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*(-?[\d,]+\.?\d*)/i,
    ],
  };

  for (const [key, list] of Object.entries(patterns) as [keyof TaxBreakdown, RegExp[]][]) {
    for (const re of list) {
      const m = text.match(re);
      if (m) {
        out[key] = num(m);
        break;
      }
    }
  }
  return out;
}

export interface OcrLineItem {
  name: string;
  hsn: string;
  quantity: number;
  rate: number;
  amount: number;
  taxPercent: number;
  matchedProductId?: string;
  matchScore?: number;
  matchedName?: string;
}

const LINE_ITEM_HSN_RE = /\b(\d{4,8})\b/;
const LINE_ITEM_NUM_RE = /\b(\d+(?:\.\d+)?)\b/g;
const LINE_ITEM_PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
const NON_ITEM_ANCHORS = /^(?:sub\s?total|subtotal|grand\s+total|total|net\s+(?:amount|payable)|amount\s+payable|cgst|sgst|utgst|igst|cess|round|balance|discount|freight|shipping|packing|handling|tds|tcs|advance|received|paid|dues?|hsn|desc|description|item\s*name|qty|rate|amount|s\.?\s*no|sno|invoice\s*no|date|bill\s*to)\b/i;

export function parseLineItems(rawText: string): OcrLineItem[] {
  const lines = rawText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const items: OcrLineItem[] = [];

  for (const line of lines) {
    if (line.length < 8 || line.length > 200) continue;
    if (NON_ITEM_ANCHORS.test(line)) continue;

    // Strip leading serial number (e.g. "1. ", "01) ", "Sl 1 ")
    let cleanLine = line.replace(/^(?:sl\.?\s*no\.?|sno\.?|item)?\s*\d+\s*[.)\-:]\s*/i, '').trim();

    const nums = [...cleanLine.matchAll(LINE_ITEM_NUM_RE)].map((m) => ({
      value: Number(m[1]),
      index: m.index ?? 0,
    }));
    if (nums.length < 2) continue;

    const amount = nums[nums.length - 1].value;
    const rate = nums[nums.length - 2].value;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;

    const hsnMatch = cleanLine.match(LINE_ITEM_HSN_RE);
    let hsn = '';
    if (hsnMatch && Number(hsnMatch[1]) >= 1000) hsn = hsnMatch[1];

    const pctMatch = cleanLine.match(LINE_ITEM_PCT_RE);
    const taxPercent = pctMatch ? Number(pctMatch[1]) : 18;

    let quantity = 1;
    for (const n of nums) {
      if (n.value === rate || n.value === amount) continue;
      if (hsn && String(n.value) === hsn) continue; // skip HSN code from quantity detection
      if (n.value > 0 && n.value < 10000 && Number.isInteger(n.value)) {
        quantity = n.value;
        break;
      }
    }

    const firstNumIdx = nums[0].index;
    let name = cleanLine.slice(0, firstNumIdx).trim();
    if (hsn) name = name.replace(new RegExp(`\\b${hsn}\\b`), '').trim();

    if (!name || !/[A-Za-z]{3,}/.test(name)) continue;
    if (name.length > 100) name = name.slice(0, 100);

    items.push({
      name,
      hsn,
      quantity,
      rate,
      amount,
      taxPercent,
    });
  }

  return items;
}

export function tokenize(s: string): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

export interface CatalogProduct {
  id: string;
  name: string;
  hsn?: string;
  taxPercent?: number;
}

export function matchProduct(
  extractedName: string,
  catalog: CatalogProduct[],
): { product: CatalogProduct; score: number } | null {
  if (!catalog.length) return null;
  const tokens = tokenize(extractedName);
  if (!tokens.size) return null;
  let best: CatalogProduct | null = null;
  let bestScore = 0.45;

  for (const p of catalog) {
    const score = jaccard(tokens, tokenize(p.name));
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }

  return best ? { product: best, score: bestScore } : null;
}

export interface ParsedBill {
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  date: string;
  grandTotal: number;
  taxBreakdown: TaxBreakdown;
  items: OcrLineItem[];
  rawText: string;
}

export function heuristicParseBill(rawText: string, catalog: CatalogProduct[] = []): ParsedBill {
  const text = rawText.replace(/[ \t]+/g, ' ');
  const gstinMatch = text.match(GSTIN_REGEX);
  const items = parseLineItems(rawText);

  const enrichedItems = items.map((it) => {
    const match = matchProduct(it.name, catalog);
    if (match) {
      return {
        ...it,
        hsn: it.hsn || match.product.hsn || '',
        taxPercent: match.product.taxPercent ?? it.taxPercent,
        matchedProductId: match.product.id,
        matchScore: match.score,
        matchedName: match.product.name,
      };
    }
    return it;
  });

  return {
    supplierGstin: gstinMatch ? gstinMatch[0] : '',
    supplierName: parseSupplierName(text),
    invoiceNumber: parseInvoiceNumber(text),
    date: parseDateFrom(text),
    grandTotal: parseGrandTotal(text),
    taxBreakdown: parseTaxBreakdown(text),
    items: enrichedItems,
    rawText,
  };
}
