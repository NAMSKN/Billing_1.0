import type Decimal from 'decimal.js';
import type { TaxTreatment } from './enums';
import type {
  Address,
  Company,
  InvoiceTotals,
  PlaceOfSupply,
  TaxRateConfig,
  TaxSummaryRow,
} from './models';

/**
 * Order documents: Sales Order, Purchase Order, and Service Request. An order is
 * a pre-invoice commercial document with its own lifecycle
 * (DRAFT -> CONFIRMED -> COMPLETED/CANCELLED). It reuses the single calculation
 * engine, the numbering service (own prefix per type), and the immutable
 * snapshot model. A confirmed order can be converted into a NEW invoice draft
 * (tax recalculated; source order kept only as a reference).
 *
 * Money/quantity/percent are Decimal in the domain; scaled-integer conversion
 * happens only at the repository boundary.
 */

export const OrderType = {
  SALES_ORDER: 'SALES_ORDER',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  SERVICE_REQUEST: 'SERVICE_REQUEST',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  SALES_ORDER: 'Sales Order',
  PURCHASE_ORDER: 'Purchase Order',
  SERVICE_REQUEST: 'Service Request',
};

/** Sales orders and service requests bill a customer; purchase orders a vendor. */
export function orderPartyIsVendor(t: OrderType): boolean {
  return t === OrderType.PURCHASE_ORDER;
}

export const OrderStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/**
 * Allowed status transitions (validated in the backend; the frontend never sets
 * status arbitrarily). DRAFT -> CONFIRMED | CANCELLED; CONFIRMED -> COMPLETED |
 * CANCELLED; COMPLETED and CANCELLED are terminal.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** A line may reference a physical product or a service (SAC-based). */
export const OrderLineItemType = {
  PRODUCT: 'PRODUCT',
  SERVICE: 'SERVICE',
} as const;
export type OrderLineItemType = (typeof OrderLineItemType)[keyof typeof OrderLineItemType];

export const ORDER_LINE_ITEM_TYPE_LABEL: Record<OrderLineItemType, string> = {
  PRODUCT: 'Product',
  SERVICE: 'Service',
};

export interface OrderLine {
  id: string;
  sequence: number;
  item_type: OrderLineItemType;
  product_id: string | null;
  description: string;
  hsn_sac: string;
  quantity: Decimal;
  unit: string;
  rate: Decimal;
  discount_percent: Decimal;
  tax_treatment: TaxTreatment;
  tax_rate: Decimal;
  note: string;
  // Calculated amounts, populated by the engine (null until computed).
  taxable_amount: Decimal | null;
  cgst_amount: Decimal | null;
  sgst_amount: Decimal | null;
  igst_amount: Decimal | null;
}

/** The counterparty snapshot (customer OR vendor) embedded into the order. */
export interface OrderParty {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  contact_person: string;
  address: Address;
}

export interface OrderSnapshot {
  company: Company;
  order_type: OrderType;
  party: OrderParty;
  ship_to: Address;
  place_of_supply: PlaceOfSupply;
  reverse_charge: boolean;
  delivery_mode: string;
  lines: OrderLine[];
  totals: InvoiceTotals;
  tax_summary: TaxSummaryRow[];
  tax_rate_config: TaxRateConfig;
  notes: string;
  terms: string;
  document_note: string;
  grand_total_words: string;
  tax_amount_words: string;
}

export interface Order {
  id: string;
  order_number: string | null;
  order_type: OrderType;
  status: OrderStatus;
  order_date: string;
  company_id: string | null;
  party_id: string | null;
  party: OrderParty;
  ship_to: Address;
  place_of_supply: PlaceOfSupply;
  reverse_charge: boolean;
  delivery_mode: string;
  lines: OrderLine[];
  totals: InvoiceTotals | null;
  notes: string;
  terms: string;
  document_note: string;
  template_version: number | null;
  snapshot: OrderSnapshot | null;
  /** Set once converted; the invoice generated from this order (reference). */
  converted_invoice_id: string | null;
  cancelled_at: string;
  cancel_reason: string;
}

export function emptyOrderParty(): OrderParty {
  return {
    party_id: null,
    name: '',
    gstin: '',
    pan: '',
    phone: '',
    contact_person: '',
    address: { line: '', state_name: '', state_code: '', godown: '' },
  };
}
