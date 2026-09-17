import type Database from 'better-sqlite3';
import { TaxTreatment } from '@shared/domain/enums';
import type { InvoiceTotals } from '@shared/domain/models';
import {
  OrderLineItemType,
  OrderStatus,
  OrderType,
  type Order,
  type OrderLine,
} from '@shared/domain/order';
import type { OrderRepository } from '@shared/domain/repositories';
import { money, percent, quantity, parseUuid, toCanonicalUuid } from './mappers';
import { deserializeOrderSnapshot, serializeOrderSnapshot } from './serialization';

interface OrderRow {
  id: string;
  company_id: string | null;
  party_id: string | null;
  order_type: string;
  status: string;
  order_number: string | null;
  order_date: string;
  place_of_supply_state: string;
  place_of_supply_code: string;
  reverse_charge: number;
  delivery_mode: string;
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
  converted_invoice_id: string | null;
  cancelled_at: string;
  cancel_reason: string;
}

interface ItemRow {
  id: string;
  order_id: string;
  sequence: number;
  item_type: string;
  product_id: string | null;
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

function itemRowToLine(row: ItemRow): OrderLine {
  return {
    id: toCanonicalUuid(row.id),
    sequence: row.sequence,
    item_type: row.item_type as OrderLineItemType,
    product_id: parseUuid(row.product_id),
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

function rowToOrder(row: OrderRow, lines: OrderLine[]): Order {
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
    order_number: row.order_number,
    order_type: row.order_type as OrderType,
    status: row.status as OrderStatus,
    order_date: row.order_date,
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
    delivery_mode: row.delivery_mode,
    lines,
    totals,
    notes: row.notes,
    terms: row.terms,
    document_note: row.document_note,
    template_version: row.template_version,
    snapshot: row.snapshot_json ? deserializeOrderSnapshot(row.snapshot_json) : null,
    converted_invoice_id: parseUuid(row.converted_invoice_id),
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
  };
}

export class SqliteOrderRepository implements OrderRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Order | null {
    const canonical = toCanonicalUuid(id);
    const row = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(canonical) as
      | OrderRow
      | undefined;
    if (!row) return null;
    const items = this.db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sequence')
      .all(canonical) as ItemRow[];
    return rowToOrder(row, items.map(itemRowToLine));
  }

  /** Headers only, no line items. */
  listSummaries(): Order[] {
    const rows = this.db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC, order_number DESC')
      .all() as OrderRow[];
    return rows.map((row) => rowToOrder(row, []));
  }

  /**
   * Upsert the header via ON CONFLICT(id) then replace all line rows wholesale.
   * Caller owns the transaction (D-026); this method does not begin/commit.
   */
  save(order: Order): void {
    const now = new Date().toISOString();
    const t = order.totals;
    this.db
      .prepare(
        `INSERT INTO orders (
           id, company_id, party_id, order_type, status, order_number,
           order_date, place_of_supply_state, place_of_supply_code, reverse_charge,
           delivery_mode,
           party_name, party_gstin, party_pan, party_phone, party_contact_person,
           party_address_line, party_state_name, party_state_code, party_godown,
           ship_line, ship_state_name, ship_state_code, ship_godown,
           template_version, notes, terms, document_note,
           total_taxable_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
           raw_total_paise, round_off_paise, grand_total_paise, snapshot_json,
           converted_invoice_id, cancelled_at, cancel_reason, created_at, updated_at
         ) VALUES (
           @id, @company_id, @party_id, @order_type, @status, @order_number,
           @order_date, @pos_state, @pos_code, @reverse_charge,
           @delivery_mode,
           @party_name, @party_gstin, @party_pan, @party_phone, @party_contact_person,
           @party_address_line, @party_state_name, @party_state_code, @party_godown,
           @ship_line, @ship_state_name, @ship_state_code, @ship_godown,
           @template_version, @notes, @terms, @document_note,
           @total_taxable_paise, @total_cgst_paise, @total_sgst_paise, @total_igst_paise,
           @raw_total_paise, @round_off_paise, @grand_total_paise, @snapshot_json,
           @converted_invoice_id, @cancelled_at, @cancel_reason, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           company_id=@company_id, party_id=@party_id, order_type=@order_type, status=@status,
           order_number=@order_number, order_date=@order_date,
           place_of_supply_state=@pos_state, place_of_supply_code=@pos_code,
           reverse_charge=@reverse_charge, delivery_mode=@delivery_mode,
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
           converted_invoice_id=@converted_invoice_id, cancelled_at=@cancelled_at,
           cancel_reason=@cancel_reason, updated_at=@updated_at`,
      )
      .run({
        id: toCanonicalUuid(order.id),
        company_id: order.company_id ? toCanonicalUuid(order.company_id) : null,
        party_id: order.party_id ? toCanonicalUuid(order.party_id) : null,
        order_type: order.order_type,
        status: order.status,
        order_number: order.order_number,
        order_date: order.order_date,
        pos_state: order.place_of_supply.state_name,
        pos_code: order.place_of_supply.state_code,
        reverse_charge: order.reverse_charge ? 1 : 0,
        delivery_mode: order.delivery_mode,
        party_name: order.party.name,
        party_gstin: order.party.gstin,
        party_pan: order.party.pan,
        party_phone: order.party.phone,
        party_contact_person: order.party.contact_person,
        party_address_line: order.party.address.line,
        party_state_name: order.party.address.state_name,
        party_state_code: order.party.address.state_code,
        party_godown: order.party.address.godown,
        ship_line: order.ship_to.line,
        ship_state_name: order.ship_to.state_name,
        ship_state_code: order.ship_to.state_code,
        ship_godown: order.ship_to.godown,
        template_version: order.template_version,
        notes: order.notes,
        terms: order.terms,
        document_note: order.document_note,
        total_taxable_paise: t ? money.toPaise(t.total_taxable) : 0,
        total_cgst_paise: t ? money.toPaise(t.total_cgst) : 0,
        total_sgst_paise: t ? money.toPaise(t.total_sgst) : 0,
        total_igst_paise: t ? money.toPaise(t.total_igst) : 0,
        raw_total_paise: t ? money.toPaise(t.raw_total) : 0,
        round_off_paise: t ? money.toPaise(t.round_off) : 0,
        grand_total_paise: t ? money.toPaise(t.grand_total) : 0,
        snapshot_json: order.snapshot ? serializeOrderSnapshot(order.snapshot) : null,
        converted_invoice_id: order.converted_invoice_id
          ? toCanonicalUuid(order.converted_invoice_id)
          : null,
        cancelled_at: order.cancelled_at,
        cancel_reason: order.cancel_reason,
        created_at: now,
        updated_at: now,
      });

    // Replace line rows wholesale.
    this.db.prepare('DELETE FROM order_items WHERE order_id = ?').run(toCanonicalUuid(order.id));
    const insertItem = this.db.prepare(
      `INSERT INTO order_items (
         id, order_id, sequence, item_type, product_id, description, hsn_sac,
         quantity_millis, unit, rate_paise, discount_hundredths, tax_treatment,
         tax_rate_hundredths, note, taxable_paise, cgst_paise, sgst_paise, igst_paise
       ) VALUES (
         @id, @order_id, @sequence, @item_type, @product_id, @description, @hsn_sac,
         @quantity_millis, @unit, @rate_paise, @discount_hundredths, @tax_treatment,
         @tax_rate_hundredths, @note, @taxable_paise, @cgst_paise, @sgst_paise, @igst_paise
       )`,
    );
    for (const line of order.lines) {
      insertItem.run({
        id: toCanonicalUuid(line.id),
        order_id: toCanonicalUuid(order.id),
        sequence: line.sequence,
        item_type: line.item_type,
        product_id: line.product_id ? toCanonicalUuid(line.product_id) : null,
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
    this.db.prepare("DELETE FROM orders WHERE id = ? AND status = 'DRAFT'").run(toCanonicalUuid(id));
  }
}
