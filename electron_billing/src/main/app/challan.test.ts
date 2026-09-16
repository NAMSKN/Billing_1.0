import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import { InvoiceStatus, TaxTreatment, TaxType } from '@shared/domain/enums';
import type { Company } from '@shared/domain/models';
import {
  ChallanDirection,
  emptyChallanParty,
  type Challan,
  type ChallanLine,
} from '@shared/domain/challan';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import { zeroBalance, type PartyInput } from './partyService';
import { ChallanFinalizationError } from './challanService';

/**
 * Challan lifecycle tests: finalize computes totals through the shared engine
 * and allocates a DC number; intra vs inter tax; snapshot immutability;
 * cancellation preserves the number; duplication yields a new draft; and
 * finalization validation blocks incomplete challans. Money is compared as
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

/** A single line whose taxable resolves to (qty 1 x rate) at 18%. */
function line(rate: string): ChallanLine {
  return {
    id: uuidv4(),
    sequence: 0,
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

function draftWith(
  lines: ChallanLine[],
  posCode = '29',
  direction = ChallanDirection.OUTWARD,
): Challan {
  const draft = app.challanService.createDraft();
  const edited: Challan = {
    ...draft,
    direction,
    party_id: partyId,
    party: { ...emptyChallanParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
    lines,
  };
  app.challanService.saveDraft(edited);
  return app.challanService.get(edited.id)!;
}

beforeEach(() => {
  const db = connectMemory();
  app = buildApplicationFromDb(db);
  company = makeCompany();
  app.companyRepo.save(company);
  partyId = app.partyService.createParty(partyInput()).id;
});

afterEach(() => app.close());

describe('challan draft lifecycle', () => {
  it('creates a draft with no number and DRAFT status', () => {
    const draft = app.challanService.createDraft();
    expect(draft.status).toBe(InvoiceStatus.DRAFT);
    expect(draft.challan_number).toBeNull();
    expect(app.challanService.get(draft.id)).not.toBeNull();
  });

  it('save_draft rejects a non-draft', () => {
    const draft = draftWith([line('100')]);
    const finalized = app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) });
    expect(() => app.challanService.saveDraft(finalized)).toThrow();
  });
});

describe('finalize computes totals through the shared engine + DC numbering', () => {
  it('intra-state: taxable 12280 -> grand 14490.00, round-off -0.40, CGST 1105.20', () => {
    const draft = draftWith([line('12280')]);
    const c = app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) });
    expect(c.status).toBe(InvoiceStatus.FINALIZED);
    expect(c.challan_number).toBe('DC/26-27/001');
    expect(c.totals!.grand_total.toFixed(2)).toBe('14490.00');
    expect(c.totals!.round_off.toFixed(2)).toBe('-0.40');
    expect(c.totals!.total_cgst.toFixed(2)).toBe('1105.20');
    expect(c.totals!.total_sgst.toFixed(2)).toBe('1105.20');
    expect(c.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTRA_STATE);
    expect(c.snapshot!.party.name).toBe('DI-TECH MOULDS');
  });

  it('inter-state place of supply produces IGST', () => {
    const draft = draftWith([line('12280')], '27');
    const c = app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) });
    expect(c.totals!.total_igst.toFixed(2)).toBe('2210.40');
    expect(c.totals!.total_cgst.toFixed(2)).toBe('0.00');
    expect(c.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTER_STATE);
  });

  it('challan numbers are sequential and never reused across finalizations', () => {
    const a = app.challanService.finalize(draftWith([line('100')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    const b = app.challanService.finalize(draftWith([line('200')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    expect(a.challan_number).toBe('DC/26-27/001');
    expect(b.challan_number).toBe('DC/26-27/002');
  });

  it('challan numbering is independent of invoice numbering (own DC sequence)', () => {
    // An invoice takes SE/.../001; the challan still starts at DC/.../001.
    const custId = app.partyService.get(partyId)!.id;
    // Finalize an invoice via the invoice service to bump the SE sequence.
    const invDraft = app.invoiceService.createDraft();
    app.invoiceService.saveDraft({
      ...invDraft,
      customer_id: custId,
      place_of_supply: { state_name: 'Karnataka', state_code: '29' },
      lines: [
        {
          id: uuidv4(),
          sequence: 0,
          job_or_mould_reference: '',
          component_or_part: '',
          operation: '',
          description: 'x',
          specification: '',
          hsn_sac: '998898',
          quantity: new Money('1'),
          unit: 'NOS',
          rate: new Money('100'),
          discount_percent: new Money('0'),
          tax_treatment: TaxTreatment.TAXABLE,
          tax_rate: new Money('18'),
          taxable_amount: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
        },
      ],
    });
    const inv = app.invoiceService.finalize(invDraft.id, { invoiceDate: new Date(2026, 5, 1) });
    expect(inv.invoice_number).toBe('SE/26-27/001');

    const c = app.challanService.finalize(draftWith([line('100')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    expect(c.challan_number).toBe('DC/26-27/001');
  });
});

describe('immutability, cancellation, duplication', () => {
  it('editing a party master does not change a finalized challan snapshot', () => {
    const c = app.challanService.finalize(draftWith([line('12280')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    // Rename the party after finalization.
    app.partyService.updateParty(partyId, partyInput({ company_name: 'RENAMED CO' }), true);
    const reloaded = app.challanService.get(c.id)!;
    expect(reloaded.snapshot!.party.name).toBe('DI-TECH MOULDS');
    expect(reloaded.totals!.grand_total.toFixed(2)).toBe('14490.00');
  });

  it('cancel preserves the record and its number', () => {
    const c = app.challanService.finalize(draftWith([line('100')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    const cancelled = app.challanService.cancel(c.id, 'wrong party', new Date(2026, 5, 2));
    expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);
    expect(cancelled.challan_number).toBe('DC/26-27/001');
    expect(cancelled.cancel_reason).toBe('wrong party');
  });

  it('duplicate creates a NEW draft with no number and cleared calc fields', () => {
    const c = app.challanService.finalize(draftWith([line('100')]).id, {
      challanDate: new Date(2026, 5, 1),
    });
    const dup = app.challanService.duplicate(c.id);
    expect(dup.id).not.toBe(c.id);
    expect(dup.status).toBe(InvoiceStatus.DRAFT);
    expect(dup.challan_number).toBeNull();
    expect(dup.lines[0].taxable_amount).toBeNull();
    expect(dup.direction).toBe(ChallanDirection.OUTWARD);
  });

  it('delete removes a draft', () => {
    const draft = draftWith([line('100')]);
    app.challanService.deleteDraft(draft.id);
    expect(app.challanService.get(draft.id)).toBeNull();
  });
});

describe('finalization validation blocks incomplete challans', () => {
  it('blocks when no place of supply', () => {
    const draft = draftWith([line('100')], '');
    expect(() => app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) })).toThrow(
      ChallanFinalizationError,
    );
  });

  it('blocks when there are no line items', () => {
    const draft = draftWith([]);
    expect(() => app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) })).toThrow(
      ChallanFinalizationError,
    );
  });
});
