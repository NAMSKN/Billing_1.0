/**
 * GSTR-2B Auto-Reconciliation Engine.
 * Matches inward purchase bills against official GSTR-2B JSON downloaded from gst.gov.in.
 */

import { round2 } from './gstr1';

export interface PurchaseRecord {
  id: string;
  supplierGstin: string;
  supplierName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
}

export interface TwoBItem {
  ctin: string; // Supplier GSTIN
  cname?: string; // Trade/Legal name
  inum: string;
  idt: string;
  val: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  itcavl?: 'Y' | 'N';
}

export type MatchStatus = 'matched' | 'amount_mismatch' | 'books_only' | 'two_b_only';

export interface ReconciliationRow {
  status: MatchStatus;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  // Books figures:
  bookTaxable: number;
  bookTax: number;
  bookTotal: number;
  // 2B figures:
  twoBTaxable: number;
  twoBTax: number;
  twoBTotal: number;
  // Differences:
  diffTaxable: number;
  diffTax: number;
  itcAvailable?: boolean;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  summary: {
    totalBooksInvoices: number;
    totalTwoBInvoices: number;
    matchedCount: number;
    amountMismatchCount: number;
    booksOnlyCount: number;
    twoBOnlyCount: number;
    matchedTax: number;
    unclaimedTax: number; // in 2B but not in books
    atRiskTax: number; // in books but not in 2B (vendor hasn't filed)
  };
}

/** Normalize invoice number for fuzzy comparison (remove spaces, slashes, dashes, lowercase). */
export function normalizeInvoiceNumber(num: string): string {
  return String(num || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Parses raw GSTR-2B JSON string or object from the GST Portal. */
export function parseGstr2bJson(jsonData: unknown): TwoBItem[] {
  const items: TwoBItem[] = [];
  const root = (jsonData as { data?: unknown; docdata?: unknown }) || {};
  // Handle various nesting layouts of gst.gov.in 2B JSON
  const dataBlock = (root.data as { docdata?: unknown }) || root;
  const docdata = (dataBlock.docdata as { b2b?: unknown[] }) || (dataBlock as { b2b?: unknown[] });
  const b2bList = Array.isArray(docdata.b2b) ? docdata.b2b : [];

  for (const rawSup of b2bList) {
    const sup = (rawSup && typeof rawSup === 'object') ? (rawSup as Record<string, unknown>) : {};
    const ctin = String(sup.ctin || '').trim();
    const cname = String(sup.cname || sup.trdnm || '').trim();
    const invList = Array.isArray(sup.inv) ? sup.inv : [];

    for (const rawInv of invList) {
      const inv = (rawInv && typeof rawInv === 'object') ? (rawInv as Record<string, unknown>) : {};
      const inum = String(inv.inum || '').trim();
      const idt = String(inv.idt || '').trim();
      const val = Number(inv.val) || 0;
      const itcavl = inv.itcavl === 'N' ? 'N' : 'Y';

      let txval = 0;
      let igst = 0;
      let cgst = 0;
      let sgst = 0;
      let cess = 0;

      const itemsList = Array.isArray(inv.items) ? inv.items : [];
      for (const rawItm of itemsList) {
        const itm = (rawItm && typeof rawItm === 'object') ? (rawItm as Record<string, unknown>) : {};
        txval += Number(itm.txval) || 0;
        igst += Number(itm.iamt) || 0;
        cgst += Number(itm.camt) || 0;
        sgst += Number(itm.samt) || 0;
        cess += Number(itm.csamt) || 0;
      }

      items.push({
        ctin,
        cname,
        inum,
        idt,
        val: round2(val),
        txval: round2(txval),
        igst: round2(igst),
        cgst: round2(cgst),
        sgst: round2(sgst),
        cess: round2(cess),
        itcavl,
      });
    }
  }

  return items;
}

/** Reconciles internal purchase bills against parsed GSTR-2B items. */
export function reconcileGstr2b(
  purchases: PurchaseRecord[],
  twoBItems: TwoBItem[],
): ReconciliationResult {
  const rows: ReconciliationRow[] = [];
  const matchedTwoBIndices = new Set<number>();

  for (const book of purchases) {
    const normBookInv = normalizeInvoiceNumber(book.invoiceNumber);
    const bookTax = round2(book.igst + book.cgst + book.sgst + book.cess);

    let foundIdx = -1;
    for (let i = 0; i < twoBItems.length; i++) {
      if (matchedTwoBIndices.has(i)) continue;
      const t = twoBItems[i];
      if (
        t.ctin.toUpperCase() === book.supplierGstin.toUpperCase() &&
        normalizeInvoiceNumber(t.inum) === normBookInv
      ) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx >= 0) {
      matchedTwoBIndices.add(foundIdx);
      const twoB = twoBItems[foundIdx];
      const twoBTax = round2(twoB.igst + twoB.cgst + twoB.sgst + twoB.cess);
      const diffTaxable = round2(Math.abs(book.taxableValue - twoB.txval));
      const diffTax = round2(Math.abs(bookTax - twoBTax));

      // Tolerance of ₹1.00 for rounding differences
      const isMatch = diffTaxable <= 1.0 && diffTax <= 1.0;

      rows.push({
        status: isMatch ? 'matched' : 'amount_mismatch',
        supplierGstin: book.supplierGstin,
        supplierName: book.supplierName || twoB.cname || '',
        invoiceNumber: book.invoiceNumber,
        invoiceDate: book.invoiceDate,
        bookTaxable: book.taxableValue,
        bookTax,
        bookTotal: book.total,
        twoBTaxable: twoB.txval,
        twoBTax,
        twoBTotal: twoB.val,
        diffTaxable,
        diffTax,
        itcAvailable: twoB.itcavl !== 'N',
      });
    } else {
      // Present in books only
      rows.push({
        status: 'books_only',
        supplierGstin: book.supplierGstin,
        supplierName: book.supplierName || '',
        invoiceNumber: book.invoiceNumber,
        invoiceDate: book.invoiceDate,
        bookTaxable: book.taxableValue,
        bookTax,
        bookTotal: book.total,
        twoBTaxable: 0,
        twoBTax: 0,
        twoBTotal: 0,
        diffTaxable: book.taxableValue,
        diffTax: bookTax,
      });
    }
  }

  // Find remaining 2B items not in books (Missed ITC)
  for (let i = 0; i < twoBItems.length; i++) {
    if (!matchedTwoBIndices.has(i)) {
      const twoB = twoBItems[i];
      const twoBTax = round2(twoB.igst + twoB.cgst + twoB.sgst + twoB.cess);
      rows.push({
        status: 'two_b_only',
        supplierGstin: twoB.ctin,
        supplierName: twoB.cname || '',
        invoiceNumber: twoB.inum,
        invoiceDate: twoB.idt,
        bookTaxable: 0,
        bookTax: 0,
        bookTotal: 0,
        twoBTaxable: twoB.txval,
        twoBTax,
        twoBTotal: twoB.val,
        diffTaxable: twoB.txval,
        diffTax: twoBTax,
        itcAvailable: twoB.itcavl !== 'N',
      });
    }
  }

  const matchedRows = rows.filter((r) => r.status === 'matched');
  const mismatchRows = rows.filter((r) => r.status === 'amount_mismatch');
  const booksOnlyRows = rows.filter((r) => r.status === 'books_only');
  const twoBOnlyRows = rows.filter((r) => r.status === 'two_b_only');

  return {
    rows,
    summary: {
      totalBooksInvoices: purchases.length,
      totalTwoBInvoices: twoBItems.length,
      matchedCount: matchedRows.length,
      amountMismatchCount: mismatchRows.length,
      booksOnlyCount: booksOnlyRows.length,
      twoBOnlyCount: twoBOnlyRows.length,
      matchedTax: round2(matchedRows.reduce((sum, r) => sum + r.twoBTax, 0)),
      unclaimedTax: round2(twoBOnlyRows.reduce((sum, r) => sum + r.twoBTax, 0)),
      atRiskTax: round2(booksOnlyRows.reduce((sum, r) => sum + r.bookTax, 0)),
    },
  };
}
