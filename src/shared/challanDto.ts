import type { InvoiceStatus, TaxTreatment } from './domain/enums';
import type { ChallanDirection, ChallanType } from './domain/challan';
import type {
  InvoiceTotalsDto,
  PlaceOfSupplyDto,
  TaxSummaryRowDto,
} from './dto';

/**
 * Delivery Challan wire DTOs. Every monetary/quantity/percent value is a
 * decimal STRING (never a float) so exact values survive the IPC boundary; the
 * main process parses/formats via challanDtoMappers.
 */

export interface AddressDto {
  line: string;
  state_name: string;
  state_code: string;
  godown: string;
}

export interface ChallanLineDto {
  id: string;
  sequence: number;
  description: string;
  hsn_sac: string;
  quantity: string;
  unit: string;
  rate: string;
  discount_percent: string;
  tax_treatment: TaxTreatment;
  tax_rate: string;
  note: string;
  taxable_amount: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
}

export interface ChallanPartyDto {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  contact_person: string;
  address: AddressDto;
}

export interface ChallanDto {
  id: string;
  challan_number: string | null;
  status: InvoiceStatus;
  direction: ChallanDirection;
  challan_type: ChallanType;
  challan_date: string;
  company_id: string | null;
  party_id: string | null;
  party: ChallanPartyDto;
  ship_to: AddressDto;
  place_of_supply: PlaceOfSupplyDto;
  reverse_charge: boolean;
  reason_for_eway: string;
  delivery_mode: string;
  vehicle_no: string;
  source_order_number: string;
  source_order_id: string | null;
  lines: ChallanLineDto[];
  totals: InvoiceTotalsDto | null;
  notes: string;
  terms: string;
  document_note: string;
  template_version: number | null;
  cancelled_at: string;
  cancel_reason: string;
  // Derived, read-only display helpers computed by main:
  grand_total_words?: string;
  tax_summary?: TaxSummaryRowDto[];
}
