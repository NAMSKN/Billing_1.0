import type Decimal from 'decimal.js';
import type {
  InvoiceKind,
  InvoiceStatus,
  LineItemType,
  PaymentStatus,
  TaxType,
  TaxTreatment,
} from './enums';

/**
 * Domain models (faithful port of Python `domain/models.py`). Monetary and
 * numeric values are `Decimal` within the domain; conversion to scaled
 * integers happens only at the repository boundary. UUIDs are canonical
 * lowercase strings (DECISIONS D-024).
 */

export interface Address {
  line: string;
  state_name: string;
  state_code: string;
  godown: string;
}

/**
 * Explicit GST component rates (percent values), per DECISIONS D-030. The
 * engine consumes these; it NEVER derives CGST/SGST by halving total_rate.
 */
export interface TaxRateConfig {
  total_rate: Decimal;
  cgst_rate: Decimal;
  sgst_rate: Decimal;
  igst_rate: Decimal;
}

export interface Asset {
  id: string;
  kind: string;
  version: number;
  sha256: string;
  stored_path: string;
  created_at: string;
}

export interface SequenceState {
  company_id: string;
  financial_year: string;
  prefix: string;
  next_sequence: number;
  high_water_mark: number;
}

export interface Company {
  id: string;
  name: string;
  address: Address;
  gstin: string;
  email: string;
  phone: string;
  bank_name: string;
  account_number: string;
  branch: string;
  ifsc: string;
  upi_id: string;
  authorized_signatory: string;
  logo_asset_id: string | null;
  signature_asset_id: string | null;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  bill_to: Address;
  ship_to: Address;
  is_active: boolean;
}

export interface InvoiceLine {
  id: string;
  sequence: number;
  /** PRODUCT or SERVICE. Preserved across order->invoice conversion. */
  item_type: LineItemType;
  /** Optional link to the catalogue item this line was prefilled from. */
  product_id: string | null;
  job_or_mould_reference: string;
  component_or_part: string;
  operation: string;
  description: string;
  specification: string;
  hsn_sac: string;
  quantity: Decimal;
  unit: string;
  rate: Decimal;
  discount_percent: Decimal;
  tax_treatment: TaxTreatment;
  tax_rate: Decimal;
  // Calculated amounts, populated by the engine (null until computed).
  taxable_amount: Decimal | null;
  cgst_amount: Decimal | null;
  sgst_amount: Decimal | null;
  igst_amount: Decimal | null;
}

export interface TaxSummaryRow {
  hsn_sac: string;
  tax_treatment: TaxTreatment;
  tax_type: TaxType;
  tax_rate: Decimal;
  taxable_value: Decimal;
  cgst_amount: Decimal;
  sgst_amount: Decimal;
  igst_amount: Decimal;
  total_tax: Decimal;
}

export interface InvoiceTotals {
  total_taxable: Decimal;
  total_cgst: Decimal;
  total_sgst: Decimal;
  total_igst: Decimal;
  raw_total: Decimal;
  round_off: Decimal;
  grand_total: Decimal;
}

export interface PlaceOfSupply {
  state_name: string;
  state_code: string;
}

export interface InvoiceReferences {
  delivery_note: string;
  delivery_note_date: string;
  reference_number: string;
  reference_date: string;
  buyer_order_number: string;
  buyer_order_date: string;
  dispatch_doc_number: string;
  dispatch_date: string;
  lr_rr_number: string;
  vehicle_number: string;
  dispatched_through: string;
  destination: string;
  terms_of_delivery: string;
  other_references: string;
}

export interface InvoiceSnapshot {
  kind: InvoiceKind;
  company: Company;
  customer: Customer;
  bill_to: Address;
  ship_to: Address;
  place_of_supply: PlaceOfSupply;
  references: InvoiceReferences;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  tax_summary: TaxSummaryRow[];
  tax_rate_config: TaxRateConfig;
  payment_terms: string;
  payment_mode: string;
  payment_type: string;
  due_date: string;
  notes: string;
  terms: string;
  declaration: string;
  source_document_type: string;
  source_document_number: string;
  grand_total_words: string;
  tax_amount_words: string;
  logo_asset_id: string | null;
  signature_asset_id: string | null;
}

export interface Invoice {
  id: string;
  /** The invoice kind: drives numbering prefix, PDF title, and billing party. */
  kind: InvoiceKind;
  invoice_number: string | null;
  status: InvoiceStatus;
  payment_status: PaymentStatus;
  invoice_date: string;
  company_id: string | null;
  /** Customer id for SALES/JOB_WORK/CUSTOM; null for a PURCHASE invoice. */
  customer_id: string | null;
  /** Vendor (party) id for a PURCHASE invoice; null otherwise. */
  party_id: string | null;
  place_of_supply: PlaceOfSupply;
  references: InvoiceReferences;
  lines: InvoiceLine[];
  totals: InvoiceTotals | null;
  payment_terms: string;
  /** Mode / terms of payment (free text, e.g. "30 days", "NEFT"). */
  payment_mode: string;
  /** Payment type label (e.g. "Cash", "Credit", "UPI"). */
  payment_type: string;
  due_date: string;
  notes: string;
  terms: string;
  declaration: string;
  /** Source document that generated this invoice (reference only). */
  source_document_type: string;
  source_document_number: string;
  source_document_id: string | null;
  template_version: number | null;
  snapshot: InvoiceSnapshot | null;
  cancelled_at: string;
  cancel_reason: string;
  replacement_invoice_id: string | null;
}

// --- Factory helpers for empty/defaulted value objects ---

export function emptyAddress(): Address {
  return { line: '', state_name: '', state_code: '', godown: '' };
}

export function emptyReferences(): InvoiceReferences {
  return {
    delivery_note: '',
    delivery_note_date: '',
    reference_number: '',
    reference_date: '',
    buyer_order_number: '',
    buyer_order_date: '',
    dispatch_doc_number: '',
    dispatch_date: '',
    lr_rr_number: '',
    vehicle_number: '',
    dispatched_through: '',
    destination: '',
    terms_of_delivery: '',
    other_references: '',
  };
}

export function emptyPlaceOfSupply(): PlaceOfSupply {
  return { state_name: '', state_code: '' };
}
