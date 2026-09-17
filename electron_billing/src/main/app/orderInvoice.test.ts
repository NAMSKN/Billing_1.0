import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import {
  InvoiceKind,
  InvoiceStatus,
  LineItemType,
  TaxTreatment,
} from '@shared/domain/enums';
import type { Company } from '@shared/domain/models';
import {
  OrderType,
  OrderLineItemType,
  emptyOrderParty,
  type Order,
  type OrderLine,
} from '@shared/domain/order';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import { zeroBalance, type PartyInput } from './partyService';
import { OrderServiceError } from './orderService';

/**
 * Order -> Invoice conversion across all three mappings:
 *   Sales Order      -> Sales Invoice     (SE prefix, customer)
 *   Service Request  -> Job Work Invoice  (JW prefix, customer, SERVICE lines)
 *   Purchase Order   -> Purchase Invoice  (PB prefix, vendor)
 * The source order number/date are carried only as a reference; a NEW invoice
 * number is generated and tax + round-off are RECALCULATED by the engine at the
 * invoice's own finalize (backend is the source of truth). Money is compared as
 * exact fixed strings.
 */

let app: Application;
let partyId: string;

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering',
    address: { line: 'Plot 1', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '29ABCDE1234F1Z5',
    email: '',
    phone: '',
    bank_name: '',
    account_number: '',
    branch: '',
    ifsc: '',
    upi_id: '',
    authorized_signatory: 'Owner',
    logo_asset_id: null,
    signature_asset_id: null,
    active: true,
  };
}

function partyInput(): PartyInput {
  return {
    company_type: PartyType.CUSTOMER_VENDOR,
    company_name: 'DI-TECH MOULDS',
    contact_person: 'Ravi',
    contact_no: '9876543210',
    email: '',
    registration_type: RegistrationType.REGULAR,
    gstin: '29ABCDE1234F1Z5',
    pan: '',
    billing_address: {
      ...emptyPartyAddress(),
      address1: '12 Area',
      state: 'Karnataka',
      state_code: '29',
      city: 'Bengaluru',
    },
    shipping_address: null,
    distance_for_eway_bill_km: null,
    group_id: null,
    bank_name: '',
    bank_ifsc_code: '',
    bank_account_number: '',
    fax_no: '',
    website: '',
    credit_limit: null,
    due_days: null,
    note: '',
    visible_on_documents: false,
    custom_field_1: '',
    custom_field_2: '',
    custom_field_3: '',
    customer_balance: zeroBalance(),
    vendor_balance: zeroBalance(),
  };
}

function line(rate: string, itemType: OrderLineItemType = OrderLineItemType.PRODUCT): OrderLine {
  return {
    id: uuidv4(),
    sequence: 0,
    item_type: itemType,
    product_id: null,
    description: itemType === OrderLineItemType.SERVICE ? 'Machining service' : 'Mould component',
    hsn_sac: '998898',
    quantity: new Money('1'),
    unit: 'NOS',
    rate: new Money(rate),
    discount_percent: new Money('0'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    note: '',
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}

/** Build a draft order of the given type, then confirm it (allocates number). */
function confirmedOrder(lines: OrderLine[], orderType: OrderType): Order {
  const draft = app.orderService.createDraft();
  app.orderService.saveDraft({
    ...draft,
    order_type: orderType,
    party_id: partyId,
    party: { ...emptyOrderParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    delivery_mode: 'By Road',
    terms: 'Order terms',
    notes: 'Order notes',
    lines,
  });
  return app.orderService.confirm(draft.id, { orderDate: new Date(2026, 5, 1) });
}

beforeEach(() => {
  const db = connectMemory();
  app = buildApplicationFromDb(db);
  app.companyRepo.save(makeCompany());
  partyId = app.partyService.createParty(partyInput()).id;
});

afterEach(() => app.close());

describe('Sales Order -> Sales Invoice', () => {
  it('creates a SALES invoice draft, keeps source as reference, recalculates tax on finalize', () => {
    const order = confirmedOrder([line('12280')], OrderType.SALES_ORDER);
    expect(order.order_number).toBe('SO/26-27/001');

    const draft = app.orderService.convertToInvoice(order.id);
    expect(draft.kind).toBe(InvoiceKind.SALES);
    expect(draft.status).toBe(InvoiceStatus.DRAFT);
    expect(draft.invoice_number).toBeNull();
    expect(draft.customer_id).toBe(partyId);
    expect(draft.party_id).toBeNull();
    // Source is a reference only — never the invoice number.
    expect(draft.references.reference_number).toBe('SO/26-27/001');
    expect(draft.source_document_number).toBe('SO/26-27/001');
    expect(draft.source_document_type).toBe(OrderType.SALES_ORDER);
    expect(draft.lines[0].item_type).toBe(LineItemType.PRODUCT);
    // Tax not yet computed on the draft.
    expect(draft.lines[0].taxable_amount).toBeNull();

    // The order records the generated invoice.
    expect(app.orderService.get(order.id)!.converted_invoice_id).toBe(draft.id);

    // Finalize: a NEW number (SE prefix) + recalculated totals.
    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 2) });
    expect(inv.invoice_number).toBe('SE/26-27/001');
    expect(inv.totals!.grand_total.toFixed(2)).toBe('14490.00');
    expect(inv.totals!.total_cgst.toFixed(2)).toBe('1105.20');
    expect(inv.snapshot!.kind).toBe(InvoiceKind.SALES);
  });
});

describe('Service Request -> Job Work Invoice', () => {
  it('creates a JOB_WORK invoice with SERVICE line items and a JW number', () => {
    const order = confirmedOrder(
      [line('8332', OrderLineItemType.SERVICE)],
      OrderType.SERVICE_REQUEST,
    );
    expect(order.order_number).toBe('SR/26-27/001');

    const draft = app.orderService.convertToInvoice(order.id);
    expect(draft.kind).toBe(InvoiceKind.JOB_WORK);
    expect(draft.customer_id).toBe(partyId);
    expect(draft.lines.every((l) => l.item_type === LineItemType.SERVICE)).toBe(true);

    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 2) });
    expect(inv.invoice_number).toBe('JW/26-27/001');
    expect(inv.totals!.grand_total.toFixed(2)).toBe('9832.00');
    expect(inv.snapshot!.lines.every((l) => l.item_type === LineItemType.SERVICE)).toBe(true);
  });
});

describe('Purchase Order -> Purchase Invoice', () => {
  it('creates a PURCHASE invoice against the vendor with a PB number', () => {
    const order = confirmedOrder([line('12280')], OrderType.PURCHASE_ORDER);
    expect(order.order_number).toBe('PO/26-27/001');

    const draft = app.orderService.convertToInvoice(order.id);
    expect(draft.kind).toBe(InvoiceKind.PURCHASE);
    // A purchase invoice bills a vendor: party_id set, customer_id null.
    expect(draft.party_id).toBe(partyId);
    expect(draft.customer_id).toBeNull();

    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 2) });
    expect(inv.invoice_number).toBe('PB/26-27/001');
    expect(inv.totals!.grand_total.toFixed(2)).toBe('14490.00');
    // Vendor resolved into the snapshot's party.
    expect(inv.snapshot!.customer.name).toBe('DI-TECH MOULDS');
    expect(inv.snapshot!.kind).toBe(InvoiceKind.PURCHASE);
  });
});

describe('per-kind numbering is independent', () => {
  it('SE / JW / PB each start at 001', () => {
    const so = app.orderService.convertToInvoice(
      confirmedOrder([line('100')], OrderType.SALES_ORDER).id,
    );
    const sr = app.orderService.convertToInvoice(
      confirmedOrder([line('100', OrderLineItemType.SERVICE)], OrderType.SERVICE_REQUEST).id,
    );
    const po = app.orderService.convertToInvoice(
      confirmedOrder([line('100')], OrderType.PURCHASE_ORDER).id,
    );
    const seInv = app.invoiceService.finalize(so.id, { invoiceDate: new Date(2026, 5, 2) });
    const jwInv = app.invoiceService.finalize(sr.id, { invoiceDate: new Date(2026, 5, 2) });
    const pbInv = app.invoiceService.finalize(po.id, { invoiceDate: new Date(2026, 5, 2) });
    expect(seInv.invoice_number).toBe('SE/26-27/001');
    expect(jwInv.invoice_number).toBe('JW/26-27/001');
    expect(pbInv.invoice_number).toBe('PB/26-27/001');
  });
});

describe('deleting a converted invoice draft', () => {
  it('succeeds and unlinks the source order (no FK failure)', () => {
    const order = confirmedOrder([line('100')], OrderType.SALES_ORDER);
    const draft = app.orderService.convertToInvoice(order.id);
    expect(app.orderService.get(order.id)!.converted_invoice_id).toBe(draft.id);

    // Must not trip the orders.converted_invoice_id foreign key.
    expect(() => app.invoiceService.deleteDraft(draft.id)).not.toThrow();

    expect(app.invoiceService.get(draft.id)).toBeNull();
    // The order is convertible again.
    expect(app.orderService.get(order.id)!.converted_invoice_id).toBeNull();
  });
});

describe('conversion guards', () => {
  it('a DRAFT order (not confirmed) cannot be converted', () => {
    const draft = app.orderService.createDraft();
    app.orderService.saveDraft({
      ...draft,
      order_type: OrderType.SALES_ORDER,
      party_id: partyId,
      party: { ...emptyOrderParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
      place_of_supply: { state_name: 'Karnataka', state_code: '29' },
      lines: [line('100')],
    });
    expect(() => app.orderService.convertToInvoice(draft.id)).toThrow(OrderServiceError);
  });
});
