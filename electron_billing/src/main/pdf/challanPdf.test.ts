import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PartyType, RegistrationType, emptyPartyAddress } from '@shared/domain/party';
import { TaxTreatment } from '@shared/domain/enums';
import type { Company } from '@shared/domain/models';
import {
  ChallanDirection,
  emptyChallanParty,
  type Challan,
  type ChallanLine,
} from '@shared/domain/challan';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { zeroBalance, type PartyInput } from '../app/partyService';
import { buildChallanRenderDto } from './challanRenderDto';
import { renderChallanPdf } from './challanRenderer';

/**
 * Challan PDF tests: a finalized challan renders to a valid non-empty A4 PDF,
 * reproduces the golden totals, and survives special characters / long text.
 * The renderer consumes only the immutable snapshot DTO.
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

function line(rate: string, description = 'Mould component'): ChallanLine {
  return {
    id: uuidv4(),
    sequence: 0,
    description,
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

function finalizeWith(lines: ChallanLine[], posCode = '29'): Challan {
  const draft = app.challanService.createDraft();
  app.challanService.saveDraft({
    ...draft,
    direction: ChallanDirection.OUTWARD,
    party_id: partyId,
    party: { ...emptyChallanParty(), party_id: partyId, name: 'DI-TECH MOULDS' },
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
    lines,
  });
  return app.challanService.finalize(draft.id, { challanDate: new Date(2026, 5, 1) });
}

beforeEach(() => {
  const db = connectMemory();
  app = buildApplicationFromDb(db);
  app.companyRepo.save(makeCompany());
  partyId = app.partyService.createParty(partyInput()).id;
});

afterEach(() => app.close());

describe('challan PDF renderer', () => {
  it('produces a valid non-empty A4 PDF buffer with golden totals', async () => {
    const c = finalizeWith([line('12280')]);
    const dto = buildChallanRenderDto(c);
    expect(dto.challan_number).toBe('DC/26-27/001');
    expect(dto.totals.grand_total).toBe('14,490.00');
    expect(dto.direction_label).toBe('Outward');

    const pdf = await renderChallanPdf(dto);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-32).toString('latin1')).toContain('%%EOF');
  });

  it('renders special characters and long content without throwing', async () => {
    const longDesc = '6 SIDE MACHINING 510X430X130 & FINISH < 0.02 > TOLERANCE '.repeat(6);
    const c = finalizeWith([line('1000', longDesc), line('2000'), line('3000')]);
    const pdf = await renderChallanPdf(buildChallanRenderDto(c));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('inter-state challan renders IGST (single tax column)', async () => {
    const c = finalizeWith([line('12280')], '27');
    const dto = buildChallanRenderDto(c);
    expect(dto.is_intra_state).toBe(false);
    expect(dto.totals.igst).toBe('2,210.40');
    const pdf = await renderChallanPdf(dto);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
