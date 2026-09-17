import type Decimal from 'decimal.js';
import type { InvoiceStatus, TaxTreatment } from './enums';
import type {
  Address,
  Company,
  InvoiceTotals,
  PlaceOfSupply,
  TaxRateConfig,
  TaxSummaryRow,
} from './models';

/**
 * Delivery Challan domain models. A challan is a movement-of-goods document
 * (not a tax invoice) that can be OUTWARD (goods sent) or INWARD (goods
 * received). Its counterparty is a Party that may be a customer OR a vendor.
 *
 * The challan reuses the single calculation engine, the numbering service (with
 * its own prefix), and the same immutability model as invoices: once finalized
 * it is reproduced from a stored snapshot and never recalculated.
 *
 * Money/quantity/percent values are Decimal in the domain; conversion to scaled
 * integers happens only at the repository boundary.
 */

/** Direction of the goods movement. */
export const ChallanDirection = {
  OUTWARD: 'OUTWARD',
  INWARD: 'INWARD',
} as const;
export type ChallanDirection = (typeof ChallanDirection)[keyof typeof ChallanDirection];

export const CHALLAN_DIRECTION_LABEL: Record<ChallanDirection, string> = {
  OUTWARD: 'Outward',
  INWARD: 'Inward',
};

/**
 * The nature/type of a delivery challan (informational; printed on the
 * document). These follow common Indian delivery-challan categories.
 */
export const ChallanType = {
  SUPPLY_ON_APPROVAL: 'SUPPLY_ON_APPROVAL',
  JOB_WORK: 'JOB_WORK',
  SUPPLY_LIQUID_GAS: 'SUPPLY_LIQUID_GAS',
  OTHER: 'OTHER',
} as const;
export type ChallanType = (typeof ChallanType)[keyof typeof ChallanType];

export const CHALLAN_TYPE_LABEL: Record<ChallanType, string> = {
  SUPPLY_ON_APPROVAL: 'Supply on Approval',
  JOB_WORK: 'Job Work',
  SUPPLY_LIQUID_GAS: 'Supply of Liquid Gas',
  OTHER: 'Others',
};

/** A single challan line. Mirrors the invoice line's editable + computed fields. */
export interface ChallanLine {
  id: string;
  sequence: number;
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

/** The counterparty snapshot (customer OR vendor) embedded into the challan. */
export interface ChallanParty {
  party_id: string | null;
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  contact_person: string;
  address: Address;
}

/**
 * Immutable finalized snapshot — the authoritative reproduction source for a
 * finalized challan (mirrors InvoiceSnapshot minus payment concepts).
 */
export interface ChallanSnapshot {
  company: Company;
  direction: ChallanDirection;
  challan_type: ChallanType;
  party: ChallanParty;
  ship_to: Address;
  place_of_supply: PlaceOfSupply;
  reverse_charge: boolean;
  reason_for_eway: string;
  delivery_mode: string;
  vehicle_no: string;
  source_order_number: string;
  lines: ChallanLine[];
  totals: InvoiceTotals;
  tax_summary: TaxSummaryRow[];
  tax_rate_config: TaxRateConfig;
  notes: string;
  terms: string;
  document_note: string;
  grand_total_words: string;
  tax_amount_words: string;
}

export interface Challan {
  id: string;
  challan_number: string | null;
  status: InvoiceStatus; // DRAFT / FINALIZED / CANCELLED
  direction: ChallanDirection;
  challan_type: ChallanType;
  challan_date: string;
  company_id: string | null;
  party_id: string | null;
  /** The counterparty details as edited on the draft (snapshot at finalize). */
  party: ChallanParty;
  ship_to: Address;
  place_of_supply: PlaceOfSupply;
  reverse_charge: boolean;
  reason_for_eway: string;
  delivery_mode: string;
  vehicle_no: string;
  /** Optional reference to a source order (e.g. a Service Request). */
  source_order_number: string;
  source_order_id: string | null;
  lines: ChallanLine[];
  totals: InvoiceTotals | null;
  notes: string;
  terms: string;
  document_note: string;
  template_version: number | null;
  snapshot: ChallanSnapshot | null;
  cancelled_at: string;
  cancel_reason: string;
}

// --- Factory helpers ---

export function emptyChallanParty(): ChallanParty {
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
