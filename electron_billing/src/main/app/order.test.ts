import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import { InvoiceStatus, TaxTreatment, TaxType } from '@shared/domain/enums';
import type { Company } from '@shared/domain/models';
import {
  OrderType,
  OrderStatus,
  OrderLineItemType,
  emptyOrderParty,
  type Order,
  type OrderLine,
} from '@shared/domain/order';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import { zeroBalance, type PartyInput } from './partyService';
import {
  OrderServiceError,
  OrderTransitionError,
  OrderConfirmError,
} from './orderService';

/**
 * Order lifecycle tests: confirm computes totals through the shared engine and
 * allocates a per-type number; status transitions are validated (illegal ones
 * rejected); a service request is service-only; a purchase order needs a vendor;
 * conversion to invoice copies fields, keeps the source as a reference, and
 * leaves tax to be RECALCULATED at the invoice's finalize. Money is compared as
 * exact fixed strings, never float.
 */

let app: Application;
let company: Company;
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

function partyInput(overrides: Partial<PartyInput> = {}): PartyInput {
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
    ...overrides,
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

function draftWith(
  lines: OrderLine[],
  orderType: OrderType = OrderType.SALES_ORDER,
  posCode = '29',
): Order {
  const draft = app.orderService.createDraft();
  const edited: Order = {
    ...draft,
    order_type: orderType,
    party_id: partyId,
    party: { ...emptyOrderParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
    lines,
  };
  app.orderService.saveDraft(edited);
  return app.orderService.get(edited.id)!;
}

beforeEach(() => {
  const db = connectMemory();
  app = buildApplicationFromDb(db);
  company = makeCompany();
  app.companyRepo.save(company);
  partyId = app.partyService.createParty(partyInput()).id;
});

afterEach(() => app.close());

describe('order draft lifecycle', () => {
  it('creates a draft with no number and DRAFT status', () => {
    const draft = app.orderService.createDraft();
    expect(draft.status).toBe(OrderStatus.DRAFT);
    expect(draft.order_number).toBeNull();
    expect(app.orderService.get(draft.id)).not.toBeNull();
  });
});

describe('confirm computes totals + per-type numbering', () => {
  it('sales order intra-state: taxable 12280 -> grand 14490.00, round -0.40, CGST 1105.20; number SO/26-27/001', () => {
    const o = app.orderService.confirm(draftWith([line('12280')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    expect(o.status).toBe(OrderStatus.CONFIRMED);
    expect(o.order_number).toBe('SO/26-27/001');
    expect(o.totals!.grand_total.toFixed(2)).toBe('14490.00');
    expect(o.totals!.round_off.toFixed(2)).toBe('-0.40');
    expect(o.totals!.total_cgst.toFixed(2)).toBe('1105.20');
    expect(o.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTRA_STATE);
  });

  it('inter-state produces IGST', () => {
    const o = app.orderService.confirm(draftWith([line('12280')], OrderType.SALES_ORDER, '27').id, {
      orderDate: new Date(2026, 5, 1),
    });
    expect(o.totals!.total_igst.toFixed(2)).toBe('2210.40');
    expect(o.totals!.total_cgst.toFixed(2)).toBe('0.00');
  });

  it('numbering is independent per order type (SO / PO / SR each start at 001)', () => {
    const so = app.orderService.confirm(draftWith([line('100')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    // A purchase order needs a vendor-capable party (CUSTOMER_VENDOR qualifies).
    const po = app.orderService.confirm(draftWith([line('100')], OrderType.PURCHASE_ORDER).id, {
      orderDate: new Date(2026, 5, 1),
    });
    const sr = app.orderService.confirm(
      draftWith([line('100', OrderLineItemType.SERVICE)], OrderType.SERVICE_REQUEST).id,
      { orderDate: new Date(2026, 5, 1) },
    );
    expect(so.order_number).toBe('SO/26-27/001');
    expect(po.order_number).toBe('PO/26-27/001');
    expect(sr.order_number).toBe('SR/26-27/001');
  });
});

describe('status transitions validated in the backend', () => {
  it('confirming an already-confirmed order throws OrderTransitionError', () => {
    const o = app.orderService.confirm(draftWith([line('100')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    expect(() => app.orderService.confirm(o.id, { orderDate: new Date(2026, 5, 1) })).toThrow(
      OrderTransitionError,
    );
  });

  it('completing a DRAFT order throws OrderTransitionError', () => {
    const draft = draftWith([line('100')]);
    expect(() => app.orderService.complete(draft.id)).toThrow(OrderTransitionError);
  });

  it('cancelling a COMPLETED order throws OrderTransitionError', () => {
    const o = app.orderService.confirm(draftWith([line('100')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    const completed = app.orderService.complete(o.id);
    expect(completed.status).toBe(OrderStatus.COMPLETED);
    expect(() => app.orderService.cancel(o.id, 'x')).toThrow(OrderTransitionError);
  });

  it('complete moves CONFIRMED -> COMPLETED; cancel preserves the number', () => {
    const o = app.orderService.confirm(draftWith([line('100')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    const cancelled = app.orderService.cancel(o.id, 'changed mind', new Date(2026, 5, 2));
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.order_number).toBe('SO/26-27/001');
    expect(cancelled.cancel_reason).toBe('changed mind');
  });
});

describe('type-specific confirmation rules', () => {
  it('a service request with a PRODUCT line is rejected', () => {
    const draft = draftWith([line('100', OrderLineItemType.PRODUCT)], OrderType.SERVICE_REQUEST);
    expect(() => app.orderService.confirm(draft.id, { orderDate: new Date(2026, 5, 1) })).toThrow(
      OrderConfirmError,
    );
  });

  it('a purchase order requires a vendor party', () => {
    const custId = app.partyService.createParty(
      partyInput({
        company_type: PartyType.CUSTOMER,
        company_name: 'Cust Only',
        gstin: '29AAACG1519K1ZP',
      }),
    ).id;
    const draft = app.orderService.createDraft();
    app.orderService.saveDraft({
      ...draft,
      order_type: OrderType.PURCHASE_ORDER,
      party_id: custId,
      party: { ...emptyOrderParty(), party_id: custId, name: 'Cust Only' },
      place_of_supply: { state_name: 'Karnataka', state_code: '29' },
      lines: [line('100')],
    });
    expect(() => app.orderService.confirm(draft.id, { orderDate: new Date(2026, 5, 1) })).toThrow(
      OrderConfirmError,
    );
  });
});

describe('duplicate + convert to invoice', () => {
  it('duplicate creates a NEW draft with no number and cleared calc fields', () => {
    const o = app.orderService.confirm(draftWith([line('100')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    const dup = app.orderService.duplicate(o.id);
    expect(dup.id).not.toBe(o.id);
    expect(dup.status).toBe(OrderStatus.DRAFT);
    expect(dup.order_number).toBeNull();
    expect(dup.lines[0].taxable_amount).toBeNull();
  });

  it('convertToInvoice copies fields, references the source, and leaves tax to finalize', () => {
    const o = app.orderService.confirm(draftWith([line('12280')]).id, {
      orderDate: new Date(2026, 5, 1),
    });
    const invoice = app.orderService.convertToInvoice(o.id);
    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.invoice_number).toBeNull();
    expect(invoice.customer_id).toBe(partyId);
    expect(invoice.references.reference_number).toBe('SO/26-27/001');
    expect(invoice.references.reference_date).toBe(o.order_date);
    expect(invoice.lines[0].hsn_sac).toBe('998898');
    expect(invoice.lines[0].rate.toFixed(2)).toBe('12280.00');
    // Tax recalculated at finalize -> calc fields still null on the draft.
    expect(invoice.lines[0].taxable_amount).toBeNull();
    // The order records the link back to the generated invoice.
    const reloaded = app.orderService.get(o.id)!;
    expect(reloaded.converted_invoice_id).toBe(invoice.id);
  });

  it('a purchase order cannot be converted to an invoice in V1', () => {
    const o = app.orderService.confirm(draftWith([line('100')], OrderType.PURCHASE_ORDER).id, {
      orderDate: new Date(2026, 5, 1),
    });
    expect(() => app.orderService.convertToInvoice(o.id)).toThrow(OrderServiceError);
  });

  it('a draft (not confirmed) cannot be converted', () => {
    const draft = draftWith([line('100')]);
    expect(() => app.orderService.convertToInvoice(draft.id)).toThrow(OrderServiceError);
  });
});
