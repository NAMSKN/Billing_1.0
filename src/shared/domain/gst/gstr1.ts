/**
 * GSTR-1 Return Preparation and JSON Generation.
 * Strictly compliant with GSTN Offline Tool Schema v1.7 and the latest portal rules
 * (including May 2025 requirement splitting Table 12 HSN summary into hsn_b2b and hsn_b2c).
 */

export const HSN_DESC_MAX = 30;

export interface Gstr1ItemDetail {
  num: number;
  itm_det: {
    rt: number;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
  };
}

export interface Gstr1B2bInvoice {
  inum: string;
  idt: string; // dd-mm-yyyy
  val: number;
  pos: string; // 2-digit state code
  rchrg: 'Y' | 'N';
  inv_typ: 'R' | 'SEWP' | 'SEWOP' | 'DE';
  itms: Gstr1ItemDetail[];
}

export interface Gstr1B2bCustomer {
  ctin: string;
  inv: Gstr1B2bInvoice[];
}

export interface Gstr1B2csRow {
  sply_ty: 'INTER' | 'INTRA';
  pos: string;
  typ: 'OE';
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr1HsnRow {
  num?: number;
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr1DocDetail {
  doc_num: number;
  doc_typ: string;
  docs: Array<{
    num: number;
    from: string;
    to: string;
    totnum: number;
    canc: number;
    net_issue: number;
  }>;
}

export interface Gstr1Payload {
  gstin: string;
  fp: string; // MMYYYY e.g. "082026"
  gt?: number;
  cur_gt?: number;
  b2b?: Gstr1B2bCustomer[];
  b2cl?: unknown[];
  b2cs?: Gstr1B2csRow[];
  cdnr?: unknown[];
  cdnur?: unknown[];
  exp?: unknown[];
  hsn?: {
    data?: Gstr1HsnRow[];
    hsn_b2b?: Gstr1HsnRow[];
    hsn_b2c?: Gstr1HsnRow[];
  };
  doc_issue?: {
    doc_det: Gstr1DocDetail[];
  };
}

/** Check if return period (MMYYYY) requires split HSN (from May 2025 onwards). */
export function isHsnSplitRequired(fp: string): boolean {
  const m = Number(String(fp).slice(0, 2));
  const y = Number(String(fp).slice(2));
  return y * 100 + m >= 202505;
}

/** Formats date into standard GST portal format: DD-MM-YYYY */
export function formatDateGST(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    // If it's already YYYY-MM-DD
    const parts = dateStr.split(/[-/]/);
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
    return dateStr;
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/** Clean up object for GST portal: drops undefined, null, empty strings, and empty arrays. */
export function stripEmpty<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const list = value.map(stripEmpty).filter((v) => v !== undefined);
    return (list.length ? list : undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = stripEmpty(v);
      if (s !== undefined) out[k] = s;
    }
    return (Object.keys(out).length ? out : undefined) as unknown as T;
  }
  return value === '' || value === null || value === undefined ? undefined : value;
}

/** Pre-flight check before exporting GSTR-1 JSON. */
export function validateGstr1Preflight(invoices: Array<{
  invoice_number?: string | null;
  invoice_date?: string;
  totals?: { grand_total: string } | null;
  customer?: { gstin?: string | null };
}>): { blocked: string[]; warnings: string[] } {
  const blocked: string[] = [];
  const warnings: string[] = [];

  for (const inv of invoices) {
    const num = inv.invoice_number || 'UNKNOWN';
    if (!inv.invoice_number) {
      blocked.push(`Invoice missing invoice number`);
    } else if (inv.invoice_number.length > 16) {
      blocked.push(`Invoice number "${num}" exceeds GSTN 16-character limit`);
    } else if (!/^[A-Za-z0-9/-]+$/.test(inv.invoice_number)) {
      blocked.push(`Invoice "${num}" contains invalid characters (only A-Z, 0-9, / and - allowed)`);
    }

    if (!inv.invoice_date) {
      blocked.push(`Invoice "${num}" is missing date`);
    }

    const ctin = inv.customer?.gstin?.trim();
    if (ctin && ctin.length !== 15) {
      warnings.push(`Invoice "${num}": Client GSTIN "${ctin}" is not 15 characters`);
    }
  }

  return { blocked, warnings };
}
