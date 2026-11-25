import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import { TaxTreatment } from '@shared/domain/enums';
import type { Company } from '@shared/domain/models';
import {
  OrderType,
  OrderLineItemType,
  emptyOrderParty,
  type Order,
  type OrderLine,
} from '@shared/domain/order';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { zeroBalance, type PartyInput } from '../app/partyService';
import { buildOrderRenderDto } from './orderRenderDto';
import { renderOrderPdf } from './orderRenderer';

/**
 * Order PDF tests: a confirmed order renders to a valid non-empty A4 PDF,
 * reproduces golden totals, and titles per type. The renderer consumes only the
 * immutable snapshot DTO.
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
    bank_name: 'State Bank',
    account_number: '123',
    branch: 'MG Road',
    ifsc: 'SBIN0001234',
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

function line(rate: string): OrderLine {
  return {
    id: uuidv4(),
    sequence: 0,
    item_type: OrderLineItemType.PRODUCT,
    product_id: null,
    description: 'Mould component',
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

function confirmWith(lines: OrderLine[], posCode = '29'): Order {
  const draft = app.orderService.createDraft();
  app.orderService.saveDraft({
    ...draft,
    order_type: OrderType.SALES_ORDER,
    party_id: partyId,
    party: { ...emptyOrderParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
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

describe('order PDF renderer', () => {
  it('produces a valid non-empty A4 PDF with golden totals and SALES ORDER title', () => {
    const o = confirmWith([line('12280')]);
    const dto = buildOrderRenderDto(o);
    expect(dto.order_number).toBe('SO/26-27/001');
    expect(dto.title).toBe('SALES ORDER');
    expect(dto.totals.grand_total).toBe('14,490.00');
    return renderOrderPdf(dto).then((pdf) => {
      expect(pdf.length).toBeGreaterThan(1000);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.subarray(-32).toString('latin1')).toContain('%%EOF');
    });
  });

  it('inter-state order renders IGST', async () => {
    const o = confirmWith([line('12280')], '27');
    const dto = buildOrderRenderDto(o);
    expect(dto.is_intra_state).toBe(false);
    expect(dto.totals.igst).toBe('2,210.40');
    const pdf = await renderOrderPdf(dto);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
