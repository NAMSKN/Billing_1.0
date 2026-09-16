import type Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';
import {
  BalanceType,
  PartyType,
  RegistrationType,
  isCustomerType,
  type OpeningBalance,
  type Party,
  type PartyAddress,
} from '@shared/domain/party';
import { validateParty } from '@shared/domain/partyValidation';
import type { PartyRepository } from '../db/partyRepository';
import type { CustomerProjection } from '../db/customerProjection';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

/**
 * Party application service (faithful port). Owns create/update/query/archive
 * and mirrors customer-capable parties into the invoice-facing customers table
 * via the injected projection. Ids/clock injected for determinism.
 */

export class PartyValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'PartyValidationError';
  }
}
export class DuplicatePartyError extends Error {
  constructor(
    message: string,
    public readonly existingId: string,
  ) {
    super(message);
    this.name = 'DuplicatePartyError';
  }
}

/** Editable content of a party (everything except id/status/timestamps). */
export interface PartyInput {
  company_type: PartyType;
  company_name: string;
  contact_person: string;
  contact_no: string;
  email: string;
  registration_type: RegistrationType;
  gstin: string;
  pan: string;
  billing_address: PartyAddress;
  shipping_address: PartyAddress | null;
  distance_for_eway_bill_km: Decimal | null;
  group_id: string | null;
  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;
  fax_no: string;
  website: string;
  credit_limit: Decimal | null;
  due_days: number | null;
  note: string;
  visible_on_documents: boolean;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  customer_balance: OpeningBalance;
  vendor_balance: OpeningBalance;
}

export class PartyService {
  constructor(
    private readonly repo: PartyRepository,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
    private readonly projection: CustomerProjection | null = null,
  ) {}

  createParty(data: PartyInput): Party {
    const now = this.clock.now().toISOString();
    const party = this.assemble(this.ids(), data, true, now, now);
    this.rejectIfInvalid(party);
    this.rejectIfDuplicate(party);
    this.persist(party);
    return party;
  }

  updateParty(id: string, data: PartyInput, isActive: boolean): Party {
    const existing = this.repo.get(id);
    const createdAt = existing ? existing.created_at : '';
    const party = this.assemble(id, data, isActive, createdAt, this.clock.now().toISOString());
    this.rejectIfInvalid(party);
    this.persist(party);
    return party;
  }

  get(id: string): Party | null {
    return this.repo.get(id);
  }

  list(partyType: PartyType | null, includeArchived: boolean): Party[] {
    return this.repo.listAll(partyType, includeArchived);
  }

  search(term: string, partyType: PartyType | null, includeArchived: boolean): Party[] {
    const parties = this.repo.listAll(partyType, includeArchived);
    const needle = term.trim().toLowerCase();
    if (!needle) return parties;
    return parties.filter((p) =>
      [p.company_name, p.contact_person, p.contact_no, p.gstin].some((f) =>
        f.toLowerCase().includes(needle),
      ),
    );
  }

  archive(id: string): boolean {
    const changed = this.repo.archive(id);
    if (changed && this.projection) this.projection.deactivate(id);
    return changed;
  }

  /** Return an existing party that matches by GSTIN, else name+phone. */
  findDuplicate(data: PartyInput): Party | null {
    const gstin = data.gstin.trim().toUpperCase();
    if (gstin) {
      const match = this.repo.getByGstin(gstin);
      if (match) return match;
    }
    if (data.company_name.trim() && data.contact_no.trim()) {
      return this.repo.findByNameAndPhone(data.company_name, data.contact_no);
    }
    return null;
  }

  // --- internals ---

  private assemble(
    id: string,
    data: PartyInput,
    isActive: boolean,
    createdAt: string,
    updatedAt: string,
  ): Party {
    return {
      id,
      company_type: data.company_type,
      company_name: data.company_name.trim(),
      contact_person: data.contact_person.trim(),
      contact_no: data.contact_no.trim(),
      email: data.email.trim(),
      registration_type: data.registration_type,
      gstin: data.gstin.trim().toUpperCase(),
      pan: data.pan.trim().toUpperCase(),
      billing_address: data.billing_address,
      shipping_address: data.shipping_address,
      distance_for_eway_bill_km: data.distance_for_eway_bill_km,
      group_id: data.group_id,
      bank_name: data.bank_name.trim(),
      bank_ifsc_code: data.bank_ifsc_code.trim().toUpperCase(),
      bank_account_number: data.bank_account_number.trim(),
      fax_no: data.fax_no.trim(),
      website: data.website.trim(),
      credit_limit: data.credit_limit,
      due_days: data.due_days,
      note: data.note.trim(),
      visible_on_documents: data.visible_on_documents,
      custom_field_1: data.custom_field_1.trim(),
      custom_field_2: data.custom_field_2.trim(),
      custom_field_3: data.custom_field_3.trim(),
      customer_balance: data.customer_balance,
      vendor_balance: data.vendor_balance,
      is_active: isActive,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  private rejectIfInvalid(party: Party): void {
    const errors = validateParty(party);
    if (errors.length) throw new PartyValidationError(errors);
  }

  private rejectIfDuplicate(party: Party): void {
    if (!party.gstin) return;
    const existing = this.repo.getByGstin(party.gstin);
    if (existing && existing.id !== party.id) {
      throw new DuplicatePartyError(
        `A party with GSTIN '${party.gstin}' already exists.`,
        existing.id,
      );
    }
  }

  private persist(party: Party): void {
    this.repo.save(party);
    if (this.projection && isCustomerType(party.company_type)) {
      this.projection.syncFromParty(party);
    }
  }
}

/** Convenience: a zero opening balance. */
export function zeroBalance(): OpeningBalance {
  return { balance_type: BalanceType.DEBIT, amount: new Money(0) };
}
