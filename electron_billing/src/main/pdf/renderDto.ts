import { TaxType } from '@shared/domain/enums';
import { formatMoney, formatQuantity } from '@shared/domain/money';
import type { Address, Company, Invoice, InvoiceSnapshot } from '@shared/domain/models';

/**
 * Immutable render DTO built from a finalized invoice's SNAPSHOT only
 * (DECISIONS D-011). The pdfkit renderer consumes this and nothing else — it
 * never touches the DB, resolves asset ids, loads mutable settings, or
 * recalculates money. All numeric values arrive as preformatted display
 * strings.
 */

export interface RenderParty {
  name: string;
  address_lines: string[];
  gstin: string;
  state: string;
}

export interface RenderReference {
  label: string;
  value: string;
}

export interface RenderLine {
  serial: number;
  job_or_mould: string;
  operation: string;
  description: string;
  specification: string;
  hsn_sac: string;
  quantity: string;
  unit: string;
  rate: string;
  discount_percent: string;
  amount: string;
}

export interface RenderTaxRow {
  hsn_sac: string;
  taxable_value: string;
  cgst_rate: string;
  cgst_amount: string;
  sgst_rate: string;
  sgst_amount: string;
  igst_rate: string;
  igst_amount: string;
  total_tax: string;
}

export interface RenderTotals {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  round_off: string;
  grand_total: string;
}

export interface InvoiceRenderDTO {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  place_of_supply: string;
  payment_terms: string;
  is_intra_state: boolean;
  cancelled: boolean;
  company: RenderParty;
  bill_to: RenderParty;
  ship_to: RenderParty;
  references: RenderReference[];
  lines: RenderLine[];
  tax_summary: RenderTaxRow[];
  totals: RenderTotals;
  grand_total_words: string;
  tax_amount_words: string;
  notes: string;
  terms: string;
  declaration: string;
  authorized_signatory: string;
  bank: { bank_name: string; account_number: string; branch: string; ifsc: string };
  upi_id: string;
  template_version: number;
}

const REFERENCE_LABELS: [keyof InvoiceSnapshot['references'], string][] = [
  ['delivery_note', 'Delivery Note'],
  ['reference_number', 'Reference No.'],
  ['reference_date', 'Reference Date'],
  ['buyer_order_number', "Buyer's Order No."],
  ['buyer_order_date', 'Order Date'],
  ['dispatch_doc_number', 'Dispatch Doc No.'],
  ['dispatch_date', 'Dispatch Date'],
  ['lr_rr_number', 'LR/RR No.'],
  ['vehicle_number', 'Vehicle No.'],
  ['dispatched_through', 'Dispatched Through'],
  ['destination', 'Destination'],
  ['terms_of_delivery', 'Terms of Delivery'],
  ['other_references', 'Other References'],
];

function formatState(name: string, code: string): string {
  if (name && code) return `${name} (${code})`;
  return name || code;
}

function isIntraState(snap: InvoiceSnapshot): boolean {
  if (snap.tax_summary.length > 0) {
    return snap.tax_summary[0].tax_type === TaxType.INTRA_STATE;
  }
  return snap.company.address.state_code.trim() === snap.place_of_supply.state_code.trim();
}

function companyParty(company: Company): RenderParty {
  const lines = [company.address.line].filter(Boolean);
  return {
    name: company.name,
    address_lines: lines,
    gstin: company.gstin,
    state: formatState(company.address.state_name, company.address.state_code),
  };
}

function addressParty(name: string, address: Address, gstin: string): RenderParty {
  const lines = [address.line, address.godown].filter(Boolean);
  return {
    name,
    address_lines: lines,
    gstin,
    state: formatState(address.state_name, address.state_code),
  };
}

/**
 * Build the render DTO for a finalized invoice from its snapshot. Throws if the
 * invoice has no snapshot (only finalized invoices are renderable).
 */
export function buildRenderDto(invoice: Invoice): InvoiceRenderDTO {
  const snap = invoice.snapshot;
  if (snap === null) {
    throw new Error('invoice has no snapshot; only finalized invoices are renderable');
  }
  const cfg = snap.tax_rate_config;
  const intra = isIntraState(snap);

  const references: RenderReference[] = REFERENCE_LABELS.flatMap(([key, label]) => {
    const value = snap.references[key];
    return value ? [{ label, value }] : [];
  });

  const lines: RenderLine[] = snap.lines.map((line, i) => ({
    serial: i + 1,
    job_or_mould: line.job_or_mould_reference,
    operation: line.operation,
    description: [line.description, line.specification].filter(Boolean).join(' — '),
    specification: line.specification,
    hsn_sac: line.hsn_sac,
    quantity: formatQuantity(line.quantity),
    unit: line.unit,
    rate: formatMoney(line.rate),
    discount_percent: line.discount_percent.toFixed(2),
    amount: formatMoney(line.taxable_amount ?? line.rate.times(line.quantity)),
  }));

  const taxSummary: RenderTaxRow[] = snap.tax_summary.map((row) => ({
    hsn_sac: row.hsn_sac,
    taxable_value: formatMoney(row.taxable_value),
    cgst_rate: intra ? cfg.cgst_rate.toFixed(2) : '',
    cgst_amount: intra ? formatMoney(row.cgst_amount) : '',
    sgst_rate: intra ? cfg.sgst_rate.toFixed(2) : '',
    sgst_amount: intra ? formatMoney(row.sgst_amount) : '',
    igst_rate: intra ? '' : cfg.igst_rate.toFixed(2),
    igst_amount: intra ? '' : formatMoney(row.igst_amount),
    total_tax: formatMoney(row.total_tax),
  }));

  return {
    invoice_number: invoice.invoice_number ?? '',
    invoice_date: invoice.invoice_date,
    due_date: snap.due_date,
    place_of_supply: formatState(snap.place_of_supply.state_name, snap.place_of_supply.state_code),
    payment_terms: snap.payment_terms,
    is_intra_state: intra,
    cancelled: invoice.status === 'CANCELLED',
    company: companyParty(snap.company),
    bill_to: addressParty(snap.customer.name, snap.bill_to, snap.customer.gstin),
    ship_to: addressParty(snap.customer.name, snap.ship_to, snap.customer.gstin),
    references,
    lines,
    tax_summary: taxSummary,
    totals: {
      taxable: formatMoney(snap.totals.total_taxable),
      cgst: formatMoney(snap.totals.total_cgst),
      sgst: formatMoney(snap.totals.total_sgst),
      igst: formatMoney(snap.totals.total_igst),
      round_off: formatMoney(snap.totals.round_off),
      grand_total: formatMoney(snap.totals.grand_total),
    },
    grand_total_words: snap.grand_total_words,
    tax_amount_words: snap.tax_amount_words,
    notes: snap.notes,
    terms: snap.terms,
    declaration: snap.declaration,
    authorized_signatory: snap.company.authorized_signatory,
    bank: {
      bank_name: snap.company.bank_name,
      account_number: snap.company.account_number,
      branch: snap.company.branch,
      ifsc: snap.company.ifsc,
    },
    upi_id: snap.company.upi_id,
    template_version: invoice.template_version ?? 1,
  };
}
