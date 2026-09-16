import type Database from 'better-sqlite3';
import { InvoiceStatus, TaxTreatment } from '@shared/domain/enums';
import type { InvoiceTotals } from '@shared/domain/models';
import {
  ChallanDirection,
  ChallanType,
  type Challan,
  type ChallanLine,
} from '@shared/domain/challan';
import type { ChallanRepository } from '@shared/domain/repositories';
import { money, percent, quantity, parseUuid, toCanonicalUuid } from './mappers';
import { deserializeChallanSnapshot, serializeChallanSnapshot } from './serialization';

interface ChallanRow {
  id: string;
  company_id: string | null;
  party_id: string | null;
  status: string;
  direction: string;
  challan_type: string;
  challan_number: string | null;
  challan_date: string;
  place_of_supply_state: string;
  place_of_supply_code: string;
  reverse_charge: number;
  reason_for_eway: string;
  delivery_mode: string;
  vehicle_no: string;
  party_name: string;
  party_gstin: string;
  party_pan: string;
  party_phone: string;
  party_contact_person: string;
  party_address_line: string;
  party_state_name: string;
  party_state_code: string;
  party_godown: string;
  ship_line: string;
  ship_state_name: string;
  ship_state_code: string;
  ship_godown: string;
  template_version: number | null;
  notes: string;
  terms: string;
  document_note: string;
  total_taxable_paise: number;
  total_cgst_paise: number;
  total_sgst_paise: number;
  total_igst_paise: number;
  raw_total_paise: number;
  round_off_paise: number;
  grand_total_paise: number;
  snapshot_json: string | null;
  cancelled_at: string;
  cancel_reason: string;
}

interface ItemRow {
  id: string;
  challan_id: string;
  sequence: number;
  description: string;
  hsn_sac: string;
  quantity_millis: number;
  unit: string;
  rate_paise: number;
  discount_hundredths: number;
  tax_treatment: string;
  tax_rate_hundredths: number;
  note: string;
  taxable_paise: number | null;
  cgst_paise: number | null;
  sgst_paise: number | null;
  igst_paise: number | null;
}

function itemRowToLine(row: ItemRow): ChallanLine {
  return {
    id: toCanonicalUuid(row.id),
    sequence: row.sequence,
    description: row.description,
    hsn_sac: row.hsn_sac,
    quantity: quantity.fromMillis(row.quantity_millis),
    unit: row.unit,
    rate: money.fromPaise(row.rate_paise),
    discount_percent: percent.fromHundredths(row.discount_hundredths),
    tax_treatment: row.tax_treatment as TaxTreatment,
    tax_rate: percent.fromHundredths(row.tax_rate_hundredths),
    note: row.note,
    taxable_amount: row.taxable_paise === null ? null : money.fromPaise(row.taxable_paise),
    cgst_amount: row.cgst_paise === null ? null : money.fromPaise(row.cgst_paise),
    sgst_amount: row.sgst_paise === null ? null : money.fromPaise(row.sgst_paise),
    igst_amount: row.igst_paise === null ? null : money.fromPaise(row.igst_paise),
  };
}

function rowToChallan(row: ChallanRow, lines: ChallanLine[]): Challan {
  const hasTotals = row.snapshot_json !== null || row.grand_total_paise !== 0;
  const totals: InvoiceTotals | null = hasTotals
    ? {
        total_taxable: money.fromPaise(row.total_taxable_paise),
        total_cgst: money.fromPaise(row.total_cgst_paise),
        total_sgst: money.fromPaise(row.total_sgst_paise),
        total_igst: money.fromPaise(row.total_igst_paise),
        raw_total: money.fromPaise(row.raw_total_paise),
        round_off: money.fromPaise(row.round_off_paise),
        grand_total: money.fromPaise(row.grand_total_paise),
      }
    : null;

  return {
    id: toCanonicalUuid(row.id),
    challan_number: row.challan_number,
    status: row.status as InvoiceStatus,
    direction: row.direction as ChallanDirection,
    challan_type: row.challan_type as ChallanType,
    challan_date: row.challan_date,
    company_id: parseUuid(row.company_id),
    party_id: parseUuid(row.party_id),
    party: {
      party_id: parseUuid(row.party_id),
      name: row.party_name,
      gstin: row.party_gstin,
      pan: row.party_pan,
      phone: row.party_phone,
      contact_person: row.party_contact_person,
      address: {
        line: row.party_address_line,
        state_name: row.party_state_name,
        state_code: row.party_state_code,
        godown: row.party_godown,
      },
    },
    ship_to: {
      line: row.ship_line,
      state_name: row.ship_state_name,
      state_code: row.ship_state_code,
      godown: row.ship_godown,
    },
    place_of_supply: {
      state_name: row.place_of_supply_state,
      state_code: row.place_of_supply_code,
    },
    reverse_charge: row.reverse_charge === 1,
    reason_for_eway: row.reason_for_eway,
    delivery_mode: row.delivery_mode,
    vehicle_no: row.vehicle_no,
    lines,
    totals,
    notes: row.notes,
    terms: row.terms,
    document_note: row.document_note,
    template_version: row.template_version,
    snapshot: row.snapshot_json ? deserializeChallanSnapshot(row.snapshot_json) : null,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
  };
}

export class SqliteChallanRepository implements ChallanRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Challan | null {
    const canonical = toCanonicalUuid(id);
    const row = this.db.prepare('SELECT * FROM challans WHERE id = ?').get(canonical) as
      | ChallanRow
      | undefined;
    if (!row) return null;
    const items = this.db
      .prepare('SELECT * FROM challan_items WHERE challan_id = ? ORDER BY sequence')
      .all(canonical) as ItemRow[];
    return rowToChallan(row, items.map(itemRowToLine));
  }

  /** Headers only, no line items. */
  listSummaries(): Challan[] {
    const rows = this.db
      .prepare('SELECT * FROM challans ORDER BY created_at DESC, challan_number DESC')
      .all() as ChallanRow[];
    return rows.map((row) => rowToChallan(row, []));
  }

  /**
   * Upsert the header via ON CONFLICT(id) then replace all line rows wholesale.
   * Caller owns the transaction (D-026); this method does not begin/commit.
   */
  save(challan: Challan): void {
    const now = new Date().toISOString();
    const t = challan.totals;
    this.db
      .prepare(
        `INSERT INTO challans (
           id, company_id, party_id, status, direction, challan_type, challan_number,
           challan_date, place_of_supply_state, place_of_supply_code, reverse_charge,
           reason_for_eway, delivery_mode, vehicle_no,
           party_name, party_gstin, party_pan, party_phone, party_contact_person,
           party_address_line, party_state_name, party_state_code, party_godown,
           ship_line, ship_state_name, ship_state_code, ship_godown,
           template_version, notes, terms, document_note,
           total_taxable_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
           raw_total_paise, round_off_paise, grand_total_paise, snapshot_json,
           cancelled_at, cancel_reason, created_at, updated_at
         ) VALUES (
           @id, @company_id, @party_id, @status, @direction, @challan_type, @challan_number,
           @challan_date, @pos_state, @pos_code, @reverse_charge,
           @reason_for_eway, @delivery_mode, @vehicle_no,
           @party_name, @party_gstin, @party_pan, @party_phone, @party_contact_person,
           @party_address_line, @party_state_name, @party_state_code, @party_godown,
           @ship_line, @ship_state_name, @ship_state_code, @ship_godown,
           @template_version, @notes, @terms, @document_note,
           @total_taxable_paise, @total_cgst_paise, @total_sgst_paise, @total_igst_paise,
           @raw_total_paise, @round_off_paise, @grand_total_paise, @snapshot_json,
           @cancelled_at, @cancel_reason, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           company_id=@company_id, party_id=@party_id, status=@status, direction=@direction,
           challan_type=@challan_type, challan_number=@challan_number, challan_date=@challan_date,
           place_of_supply_state=@pos_state, place_of_supply_code=@pos_code,
           reverse_charge=@reverse_charge, reason_for_eway=@reason_for_eway,
           delivery_mode=@delivery_mode, vehicle_no=@vehicle_no,
           party_name=@party_name, party_gstin=@party_gstin, party_pan=@party_pan,
           party_phone=@party_phone, party_contact_person=@party_contact_person,
           party_address_line=@party_address_line, party_state_name=@party_state_name,
           party_state_code=@party_state_code, party_godown=@party_godown,
           ship_line=@ship_line, ship_state_name=@ship_state_name,
           ship_state_code=@ship_state_code, ship_godown=@ship_godown,
           template_version=@template_version, notes=@notes, terms=@terms,
           document_note=@document_note,
           total_taxable_paise=@total_taxable_paise, total_cgst_paise=@total_cgst_paise,
           total_sgst_paise=@total_sgst_paise, total_igst_paise=@total_igst_paise,
           raw_total_paise=@raw_total_paise, round_off_paise=@round_off_paise,
           grand_total_paise=@grand_total_paise, snapshot_json=@snapshot_json,
           cancelled_at=@cancelled_at, cancel_reason=@cancel_reason, updated_at=@updated_at`,
      )
      .run({
        id: toCanonicalUuid(challan.id),
        company_id: challan.company_id ? toCanonicalUuid(challan.company_id) : null,
        party_id: challan.party_id ? toCanonicalUuid(challan.party_id) : null,
        status: challan.status,
        direction: challan.direction,
        challan_type: challan.challan_type,
        challan_number: challan.challan_number,
        challan_date: challan.challan_date,
        pos_state: challan.place_of_supply.state_name,
        pos_code: challan.place_of_supply.state_code,
        reverse_charge: challan.reverse_charge ? 1 : 0,
        reason_for_eway: challan.reason_for_eway,
        delivery_mode: challan.delivery_mode,
        vehicle_no: challan.vehicle_no,
        party_name: challan.party.name,
        party_gstin: challan.party.gstin,
        party_pan: challan.party.pan,
        party_phone: challan.party.phone,
        party_contact_person: challan.party.contact_person,
        party_address_line: challan.party.address.line,
        party_state_name: challan.party.address.state_name,
        party_state_code: challan.party.address.state_code,
        party_godown: challan.party.address.godown,
        ship_line: challan.ship_to.line,
        ship_state_name: challan.ship_to.state_name,
        ship_state_code: challan.ship_to.state_code,
        ship_godown: challan.ship_to.godown,
        template_version: challan.template_version,
        notes: challan.notes,
        terms: challan.terms,
        document_note: challan.document_note,
        total_taxable_paise: t ? money.toPaise(t.total_taxable) : 0,
        total_cgst_paise: t ? money.toPaise(t.total_cgst) : 0,
        total_sgst_paise: t ? money.toPaise(t.total_sgst) : 0,
        total_igst_paise: t ? money.toPaise(t.total_igst) : 0,
        raw_total_paise: t ? money.toPaise(t.raw_total) : 0,
        round_off_paise: t ? money.toPaise(t.round_off) : 0,
        grand_total_paise: t ? money.toPaise(t.grand_total) : 0,
        snapshot_json: challan.snapshot ? serializeChallanSnapshot(challan.snapshot) : null,
        cancelled_at: challan.cancelled_at,
        cancel_reason: challan.cancel_reason,
        created_at: now,
        updated_at: now,
      });

    // Replace line rows wholesale.
    this.db
      .prepare('DELETE FROM challan_items WHERE challan_id = ?')
      .run(toCanonicalUuid(challan.id));
    const insertItem = this.db.prepare(
      `INSERT INTO challan_items (
         id, challan_id, sequence, description, hsn_sac, quantity_millis, unit, rate_paise,
         discount_hundredths, tax_treatment, tax_rate_hundredths, note,
         taxable_paise, cgst_paise, sgst_paise, igst_paise
       ) VALUES (
         @id, @challan_id, @sequence, @description, @hsn_sac, @quantity_millis, @unit, @rate_paise,
         @discount_hundredths, @tax_treatment, @tax_rate_hundredths, @note,
         @taxable_paise, @cgst_paise, @sgst_paise, @igst_paise
       )`,
    );
    for (const line of challan.lines) {
      insertItem.run({
        id: toCanonicalUuid(line.id),
        challan_id: toCanonicalUuid(challan.id),
        sequence: line.sequence,
        description: line.description,
        hsn_sac: line.hsn_sac,
        quantity_millis: quantity.toMillis(line.quantity),
        unit: line.unit,
        rate_paise: money.toPaise(line.rate),
        discount_hundredths: percent.toHundredths(line.discount_percent),
        tax_treatment: line.tax_treatment,
        tax_rate_hundredths: percent.toHundredths(line.tax_rate),
        note: line.note,
        taxable_paise: line.taxable_amount === null ? null : money.toPaise(line.taxable_amount),
        cgst_paise: line.cgst_amount === null ? null : money.toPaise(line.cgst_amount),
        sgst_paise: line.sgst_amount === null ? null : money.toPaise(line.sgst_amount),
        igst_paise: line.igst_amount === null ? null : money.toPaise(line.igst_amount),
      });
    }
  }

  /** Delete only drafts; FK cascade removes line items. */
  deleteDraft(id: string): void {
    this.db
      .prepare("DELETE FROM challans WHERE id = ? AND status = 'DRAFT'")
      .run(toCanonicalUuid(id));
  }
}
