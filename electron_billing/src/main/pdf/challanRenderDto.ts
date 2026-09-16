import { TaxType } from '@shared/domain/enums';
import { formatMoney, formatQuantity } from '@shared/domain/money';
import { CHALLAN_DIRECTION_LABEL, CHALLAN_TYPE_LABEL } from '@shared/domain/challan';
import type { Challan, ChallanSnapshot } from '@shared/domain/challan';
import type { Address, Company } from '@shared/domain/models';

/**
 * Immutable render DTO for a finalized challan, built from the stored SNAPSHOT
 * only (D-011). The renderer consumes this and nothing else — it never touches
 * the DB or recalculates. All numeric values arrive as preformatted strings.
 */

export interface RenderParty {
  name: string;
  address_lines: string[];
  gstin: string;
  state: string;
}

export interface RenderLine {
  serial: number;
  description: string;
  note: string;
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

export interface ChallanRenderDTO {
  challan_number: string;
  challan_date: string;
  direction_label: string;
  challan_type_label: string;
  place_of_supply: string;
  reverse_charge: boolean;
  reason_for_eway: string;
  delivery_mode: string;
  vehicle_no: string;
  is_intra_state: boolean;
  cancelled: boolean;
  company: RenderParty;
  party: RenderParty;
  party_label: string;
  ship_to: RenderParty;
  lines: RenderLine[];
  tax_summary: RenderTaxRow[];
  totals: RenderTotals;
  grand_total_words: string;
  tax_amount_words: string;
  notes: string;
  terms: string;
  authorized_signatory: string;
  bank: { bank_name: string; account_number: string; branch: string; ifsc: string };
  upi_id: string;
}

function formatState(name: string, code: string): string {
  if (name && code) return `${name} (${code})`;
  return name || code;
}

function isIntraState(snap: ChallanSnapshot): boolean {
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
 * Build the render DTO for a finalized challan from its snapshot. Throws if the
 * challan has no snapshot (only finalized challans are renderable).
 */
export function buildChallanRenderDto(challan: Challan): ChallanRenderDTO {
  const snap = challan.snapshot;
  if (snap === null) {
    throw new Error('challan has no snapshot; only finalized challans are renderable');
  }
  const cfg = snap.tax_rate_config;
  const intra = isIntraState(snap);

  const lines: RenderLine[] = snap.lines.map((line, i) => ({
    serial: i + 1,
    description: line.description,
    note: line.note,
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

  // Outward = we ship to the counterparty; Inward = goods received from them.
  const partyLabel = snap.direction === 'OUTWARD' ? 'CONSIGNEE (SHIP TO)' : 'CONSIGNOR (FROM)';

  return {
    challan_number: challan.challan_number ?? '',
    challan_date: challan.challan_date,
    direction_label: CHALLAN_DIRECTION_LABEL[snap.direction],
    challan_type_label: CHALLAN_TYPE_LABEL[snap.challan_type],
    place_of_supply: formatState(snap.place_of_supply.state_name, snap.place_of_supply.state_code),
    reverse_charge: snap.reverse_charge,
    reason_for_eway: snap.reason_for_eway,
    delivery_mode: snap.delivery_mode,
    vehicle_no: snap.vehicle_no,
    is_intra_state: intra,
    cancelled: challan.status === 'CANCELLED',
    company: companyParty(snap.company),
    party: addressParty(snap.party.name, snap.party.address, snap.party.gstin),
    party_label: partyLabel,
    ship_to: addressParty(snap.party.name, snap.ship_to, snap.party.gstin),
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
    authorized_signatory: snap.company.authorized_signatory,
    bank: {
      bank_name: snap.company.bank_name,
      account_number: snap.company.account_number,
      branch: snap.company.branch,
      ifsc: snap.company.ifsc,
    },
    upi_id: snap.company.upi_id,
  };
}
