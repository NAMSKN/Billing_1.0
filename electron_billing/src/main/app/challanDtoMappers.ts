import { Money } from '@shared/domain/money';
import type { Address, InvoiceTotals, TaxSummaryRow } from '@shared/domain/models';
import type {
  Challan,
  ChallanLine,
  ChallanParty,
} from '@shared/domain/challan';
import type {
  AddressDto,
  ChallanDto,
  ChallanLineDto,
  ChallanPartyDto,
} from '@shared/challanDto';
import type { InvoiceTotalsDto, TaxSummaryRowDto } from '@shared/dto';

/**
 * Domain <-> wire DTO conversions for challans. Money crosses IPC as decimal
 * strings; parse/format happens here at the main-process boundary. Mirrors
 * dtoMappers.ts. The snapshot is never sent to the renderer.
 */

const str = (v: { toFixed(n: number): string }): string => v.toFixed(2);

function addressToDto(a: Address): AddressDto {
  return { line: a.line, state_name: a.state_name, state_code: a.state_code, godown: a.godown };
}
function addressFromDto(d: AddressDto): Address {
  return { line: d.line, state_name: d.state_name, state_code: d.state_code, godown: d.godown };
}

function partyToDto(p: ChallanParty): ChallanPartyDto {
  return {
    party_id: p.party_id,
    name: p.name,
    gstin: p.gstin,
    pan: p.pan,
    phone: p.phone,
    contact_person: p.contact_person,
    address: addressToDto(p.address),
  };
}
function partyFromDto(d: ChallanPartyDto): ChallanParty {
  return {
    party_id: d.party_id,
    name: d.name,
    gstin: d.gstin,
    pan: d.pan,
    phone: d.phone,
    contact_person: d.contact_person,
    address: addressFromDto(d.address),
  };
}

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

function lineToDto(l: ChallanLine): ChallanLineDto {
  return {
    id: l.id,
    sequence: l.sequence,
    description: l.description,
    hsn_sac: l.hsn_sac,
    quantity: l.quantity.toString(),
    unit: l.unit,
    rate: str(l.rate),
    discount_percent: str(l.discount_percent),
    tax_treatment: l.tax_treatment,
    tax_rate: str(l.tax_rate),
    note: l.note,
    taxable_amount: l.taxable_amount ? str(l.taxable_amount) : null,
    cgst_amount: l.cgst_amount ? str(l.cgst_amount) : null,
    sgst_amount: l.sgst_amount ? str(l.sgst_amount) : null,
    igst_amount: l.igst_amount ? str(l.igst_amount) : null,
  };
}

function lineFromDto(d: ChallanLineDto): ChallanLine {
  return {
    id: d.id,
    sequence: d.sequence,
    description: d.description,
    hsn_sac: d.hsn_sac,
    quantity: new Money(d.quantity || '0'),
    unit: d.unit,
    rate: new Money(d.rate || '0'),
    discount_percent: new Money(d.discount_percent || '0'),
    tax_treatment: d.tax_treatment,
    tax_rate: new Money(d.tax_rate || '0'),
    note: d.note,
    taxable_amount: d.taxable_amount ? new Money(d.taxable_amount) : null,
    cgst_amount: d.cgst_amount ? new Money(d.cgst_amount) : null,
    sgst_amount: d.sgst_amount ? new Money(d.sgst_amount) : null,
    igst_amount: d.igst_amount ? new Money(d.igst_amount) : null,
  };
}

export function challanToDto(c: Challan): ChallanDto {
  return {
    id: c.id,
    challan_number: c.challan_number,
    status: c.status,
    direction: c.direction,
    challan_type: c.challan_type,
    challan_date: c.challan_date,
    company_id: c.company_id,
    party_id: c.party_id,
    party: partyToDto(c.party),
    ship_to: addressToDto(c.ship_to),
    place_of_supply: c.place_of_supply,
    reverse_charge: c.reverse_charge,
    reason_for_eway: c.reason_for_eway,
    delivery_mode: c.delivery_mode,
    vehicle_no: c.vehicle_no,
    source_order_number: c.source_order_number,
    source_order_id: c.source_order_id,
    lines: c.lines.map(lineToDto),
    totals: c.totals ? totalsToDto(c.totals) : null,
    notes: c.notes,
    terms: c.terms,
    document_note: c.document_note,
    template_version: c.template_version,
    cancelled_at: c.cancelled_at,
    cancel_reason: c.cancel_reason,
    grand_total_words: c.snapshot?.grand_total_words,
    tax_summary: c.snapshot?.tax_summary.map(taxRowToDto),
  };
}

export function challanFromDto(d: ChallanDto): Challan {
  return {
    id: d.id,
    challan_number: d.challan_number,
    status: d.status,
    direction: d.direction,
    challan_type: d.challan_type,
    challan_date: d.challan_date,
    company_id: d.company_id,
    party_id: d.party_id,
    party: partyFromDto(d.party),
    ship_to: addressFromDto(d.ship_to),
    place_of_supply: d.place_of_supply,
    reverse_charge: d.reverse_charge,
    reason_for_eway: d.reason_for_eway,
    delivery_mode: d.delivery_mode,
    vehicle_no: d.vehicle_no,
    source_order_number: d.source_order_number,
    source_order_id: d.source_order_id,
    lines: d.lines.map(lineFromDto),
    totals: null, // totals are engine-computed at finalize, never trusted from UI
    notes: d.notes,
    terms: d.terms,
    document_note: d.document_note,
    template_version: d.template_version,
    snapshot: null,
    cancelled_at: d.cancelled_at,
    cancel_reason: d.cancel_reason,
  };
}
