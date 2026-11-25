import type {
  InvoiceKind,
  InvoiceStatus,
  LineItemType,
  PaymentStatus,
  TaxType,
  TaxTreatment,
} from './domain/enums';

/**
 * Wire DTOs crossing the IPC boundary. Every monetary/numeric value is a
 * decimal STRING (e.g. "12280.00"), never a JS float, to preserve exactness.
 * The main process converts to/from Decimal at its boundary; the renderer
 * treats these as display/edit strings.
 */

export interface AddressDto {
  line: string;
  state_name: string;
  state_code: string;
  godown: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  address: AddressDto;
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

export interface CustomerDto {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  bill_to: AddressDto;
  ship_to: AddressDto;
  is_active: boolean;
}

export interface InvoiceLineDto {
  id: string;
  sequence: number;
  item_type: LineItemType;
  product_id: string | null;
  job_or_mould_reference: string;
  component_or_part: string;
  operation: string;
  description: string;
  specification: string;
  hsn_sac: string;
  quantity: string;
  unit: string;
  rate: string;
  discount_percent: string;
  tax_treatment: TaxTreatment;
  tax_rate: string;
  taxable_amount: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
}

export interface InvoiceReferencesDto {
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

export interface PlaceOfSupplyDto {
  state_name: string;
  state_code: string;
}

export interface InvoiceTotalsDto {
  total_taxable: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  raw_total: string;
  round_off: string;
  grand_total: string;
}

export interface TaxSummaryRowDto {
  hsn_sac: string;
  tax_treatment: TaxTreatment;
  tax_type: TaxType;
  tax_rate: string;
  taxable_value: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_tax: string;
}

export interface InvoiceDto {
  id: string;
  kind: InvoiceKind;
  invoice_number: string | null;
  status: InvoiceStatus;
  payment_status: PaymentStatus;
  invoice_date: string;
  company_id: string | null;
  customer_id: string | null;
  party_id: string | null;
  place_of_supply: PlaceOfSupplyDto;
  references: InvoiceReferencesDto;
  lines: InvoiceLineDto[];
  totals: InvoiceTotalsDto | null;
  payment_terms: string;
  payment_mode: string;
  payment_type: string;
  due_date: string;
  notes: string;
  terms: string;
  declaration: string;
  source_document_type: string;
  source_document_number: string;
  source_document_id: string | null;
  template_version: number | null;
  cancelled_at: string;
  cancel_reason: string;
  replacement_invoice_id: string | null;
  // Derived, read-only display helpers computed by main:
  grand_total_words?: string;
  tax_summary?: TaxSummaryRowDto[];
  /** Resolved counterparty (customer or vendor) name for list display. */
  party_name?: string;
}

export interface TaxRateConfigDto {
  total_rate: string;
  cgst_rate: string;
  sgst_rate: string;
  igst_rate: string;
}

export interface CalcPreviewRequest {
  companyStateCode: string;
  placeOfSupplyStateCode: string;
  taxConfig: TaxRateConfigDto;
  lines: {
    hsn_sac: string;
    quantity: string;
    rate: string;
    discount_percent: string;
  }[];
}

export interface CalcPreviewResponse {
  tax_type: TaxType;
  lines: {
    gross: string;
    discount: string;
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    amount: string;
  }[];
  totals: InvoiceTotalsDto;
  tax_summary: TaxSummaryRowDto[];
  grand_total_words: string;
  tax_amount_words: string;
}
