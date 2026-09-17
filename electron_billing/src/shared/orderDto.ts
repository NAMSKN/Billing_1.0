import type { TaxTreatment } from './domain/enums';
import type { OrderType, OrderStatus, OrderLineItemType } from './domain/order';
import type { AddressDto } from './challanDto';
import type { InvoiceTotalsDto, PlaceOfSupplyDto, TaxSummaryRowDto } from './dto';

/**
 * Order wire DTOs (Sales Order / Purchase Order / Service Request). Every
 * monetary/quantity/percent value is a decimal STRING (never a float); the main
 * process parses/formats via orderDtoMappers.
 */

export interface OrderLineDto {
  id: string;
  sequence: number;
  item_type: OrderLineItemType;
  product_id: string | null;
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

export interface OrderPartyDto {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  contact_person: string;
  address: AddressDto;
}

export interface OrderDto {
  id: string;
  order_number: string | null;
  order_type: OrderType;
  status: OrderStatus;
  order_date: string;
  company_id: string | null;
  party_id: string | null;
  party: OrderPartyDto;
  ship_to: AddressDto;
  place_of_supply: PlaceOfSupplyDto;
  reverse_charge: boolean;
  delivery_mode: string;
  lines: OrderLineDto[];
  totals: InvoiceTotalsDto | null;
  notes: string;
  terms: string;
  document_note: string;
  template_version: number | null;
  converted_invoice_id: string | null;
  cancelled_at: string;
  cancel_reason: string;
  // Derived, read-only display helpers computed by main:
  grand_total_words?: string;
  tax_summary?: TaxSummaryRowDto[];
}
