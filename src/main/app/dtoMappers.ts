import { Money } from '@shared/domain/money';
import type {
  Company,
  Customer,
  Invoice,
  InvoiceLine,
  InvoiceReferences,
  InvoiceTotals,
  TaxRateConfig,
  TaxSummaryRow,
} from '@shared/domain/models';
import type {
  CompanyDto,
  CustomerDto,
  InvoiceDto,
  InvoiceLineDto,
  InvoiceTotalsDto,
  TaxRateConfigDto,
  TaxSummaryRowDto,
} from '@shared/dto';

/**
 * Domain <-> wire DTO conversions. Money crosses the IPC boundary as decimal
 * strings; here we parse/format at the main-process boundary. Snapshot is not
 * sent to the renderer (it is authoritative server-side); the renderer gets the
 * display fields it needs.
 */

const str = (v: { toFixed(n: number): string }): string => v.toFixed(2);

// --- Company ---
export function companyToDto(c: Company): CompanyDto {
  return { ...c };
}
export function companyFromDto(d: CompanyDto): Company {
  return { ...d };
}

// --- Customer ---
export function customerToDto(c: Customer): CustomerDto {
  return { ...c };
}
export function customerFromDto(d: CustomerDto): Customer {
  return { ...d };
}

// --- Totals / tax summary ---
function totalsToDto(t: InvoiceTotals): InvoiceTotalsDto {
  return {
    total_taxable: str(t.total_taxable),
    total_cgst: str(t.total_cgst),
    total_sgst: str(t.total_sgst),
    total_igst: str(t.total_igst),
    raw_total: str(t.raw_total),
    round_off: str(t.round_off),
    grand_total: str(t.grand_total),
  };
}

function taxRowToDto(r: TaxSummaryRow): TaxSummaryRowDto {
  return {
    hsn_sac: r.hsn_sac,
    tax_treatment: r.tax_treatment,
    tax_type: r.tax_type,
    tax_rate: str(r.tax_rate),
    taxable_value: str(r.taxable_value),
    cgst_amount: str(r.cgst_amount),
    sgst_amount: str(r.sgst_amount),
    igst_amount: str(r.igst_amount),
    total_tax: str(r.total_tax),
  };
}

// --- Line ---
function lineToDto(l: InvoiceLine): InvoiceLineDto {
  const amount = l.taxable_amount ? str(l.taxable_amount) : null;
  return {
    id: l.id,
    sequence: l.sequence,
    item_type: l.item_type,
    product_id: l.product_id,
    job_or_mould_reference: l.job_or_mould_reference,
    component_or_part: l.component_or_part,
    operation: l.operation,
    description: l.description,
    specification: l.specification,
    hsn_sac: l.hsn_sac,
    quantity: l.quantity.toString(),
    unit: l.unit,
    rate: str(l.rate),
    discount_percent: str(l.discount_percent),
    tax_treatment: l.tax_treatment,
    tax_rate: str(l.tax_rate),
    taxable_amount: amount,
    cgst_amount: l.cgst_amount ? str(l.cgst_amount) : null,
    sgst_amount: l.sgst_amount ? str(l.sgst_amount) : null,
    igst_amount: l.igst_amount ? str(l.igst_amount) : null,
  };
}

export function lineFromDto(d: InvoiceLineDto): InvoiceLine {
  return {
    id: d.id,
    sequence: d.sequence,
    item_type: d.item_type,
    product_id: d.product_id,
    job_or_mould_reference: d.job_or_mould_reference,
    component_or_part: d.component_or_part,
    operation: d.operation,
    description: d.description,
    specification: d.specification,
    hsn_sac: d.hsn_sac,
    quantity: new Money(d.quantity || '0'),
    unit: d.unit,
    rate: new Money(d.rate || '0'),
    discount_percent: new Money(d.discount_percent || '0'),
    tax_treatment: d.tax_treatment,
    tax_rate: new Money(d.tax_rate || '0'),
    taxable_amount: d.taxable_amount ? new Money(d.taxable_amount) : null,
    cgst_amount: d.cgst_amount ? new Money(d.cgst_amount) : null,
    sgst_amount: d.sgst_amount ? new Money(d.sgst_amount) : null,
    igst_amount: d.igst_amount ? new Money(d.igst_amount) : null,
  };
}

// --- Invoice ---
export function invoiceToDto(inv: Invoice): InvoiceDto {
  return {
    id: inv.id,
    kind: inv.kind,
    invoice_number: inv.invoice_number,
    status: inv.status,
    payment_status: inv.payment_status,
    invoice_date: inv.invoice_date,
    company_id: inv.company_id,
    customer_id: inv.customer_id,
    party_id: inv.party_id,
    place_of_supply: inv.place_of_supply,
    references: inv.references,
    lines: inv.lines.map(lineToDto),
    totals: inv.totals ? totalsToDto(inv.totals) : null,
    payment_terms: inv.payment_terms,
    payment_mode: inv.payment_mode,
    payment_type: inv.payment_type,
    due_date: inv.due_date,
    notes: inv.notes,
    terms: inv.terms,
    declaration: inv.declaration,
    source_document_type: inv.source_document_type,
    source_document_number: inv.source_document_number,
    source_document_id: inv.source_document_id,
    template_version: inv.template_version,
    cancelled_at: inv.cancelled_at,
    cancel_reason: inv.cancel_reason,
    replacement_invoice_id: inv.replacement_invoice_id,
    grand_total_words: inv.snapshot?.grand_total_words,
    tax_summary: inv.snapshot?.tax_summary.map(taxRowToDto),
    // Finalized invoices carry the counterparty name in their snapshot; drafts
    // are resolved by the list handler against the party/customer master.
    party_name: inv.snapshot?.customer?.name,
  };
}

export function invoiceFromDto(d: InvoiceDto): Invoice {
  return {
    id: d.id,
    kind: d.kind,
    invoice_number: d.invoice_number,
    status: d.status,
    payment_status: d.payment_status,
    invoice_date: d.invoice_date,
    company_id: d.company_id,
    customer_id: d.customer_id,
    party_id: d.party_id,
    place_of_supply: d.place_of_supply,
    references: d.references as InvoiceReferences,
    lines: d.lines.map(lineFromDto),
    totals: null, // totals are engine-computed at finalize, never trusted from the UI
    payment_terms: d.payment_terms,
    payment_mode: d.payment_mode,
    payment_type: d.payment_type,
    due_date: d.due_date,
    notes: d.notes,
    terms: d.terms,
    declaration: d.declaration,
    source_document_type: d.source_document_type,
    source_document_number: d.source_document_number,
    source_document_id: d.source_document_id,
    template_version: d.template_version,
    snapshot: null,
    cancelled_at: d.cancelled_at,
    cancel_reason: d.cancel_reason,
    replacement_invoice_id: d.replacement_invoice_id,
  };
}

export function taxConfigFromDto(d: TaxRateConfigDto): TaxRateConfig {
  return {
    total_rate: new Money(d.total_rate),
    cgst_rate: new Money(d.cgst_rate),
    sgst_rate: new Money(d.sgst_rate),
    igst_rate: new Money(d.igst_rate),
  };
}

export function taxConfigToDto(c: TaxRateConfig): TaxRateConfigDto {
  return {
    total_rate: c.total_rate.toString(),
    cgst_rate: c.cgst_rate.toString(),
    sgst_rate: c.sgst_rate.toString(),
    igst_rate: c.igst_rate.toString(),
  };
}

export { totalsToDto, taxRowToDto, lineToDto };
