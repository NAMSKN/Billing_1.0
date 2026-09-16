import type Database from 'better-sqlite3';
import { InvoiceStatus, TaxType } from '@shared/domain/enums';
import type { Company, Address, InvoiceTotals } from '@shared/domain/models';
import type { CompanyRepository } from '@shared/domain/repositories';
import type { ChallanRepository } from '@shared/domain/repositories';
import {
  ChallanDirection,
  ChallanType,
  emptyChallanParty,
  type Challan,
  type ChallanLine,
  type ChallanParty,
  type ChallanSnapshot,
} from '@shared/domain/challan';
import type { Party, PartyAddress } from '@shared/domain/party';
import type { PartyRepository } from '../db/partyRepository';
import {
  calculateInvoiceTotals,
  calculateLine,
  calculateLineTax,
  buildTaxSummary,
  determineTaxType,
  ensureSupportedTreatment,
  type TaxLineInput,
} from '@shared/domain/calculation';
import { amountInWords } from '@shared/domain/amountWords';
import type { NumberingConfig } from '@shared/domain/numbering';
import { withImmediateTransaction } from './unitOfWork';
import { NumberingService } from './numberingService';
import { SettingsService } from './settingsService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

const DEFAULT_TEMPLATE_VERSION = 1;

/** Distinct numbering prefix so challan numbers never collide with invoices. */
const CHALLAN_PREFIX = 'DC';

export class ChallanServiceError extends Error {}
export class ChallanFinalizationError extends Error {
  constructor(
    message: string,
    public readonly issues?: string[],
  ) {
    super(message);
  }
}

export interface ChallanFinalizeArgs {
  challanDate: Date;
  today?: Date | null;
}

/** Join a structured party address into the single-line invoice-module Address. */
function toDocumentAddress(address: PartyAddress): Address {
  const parts = [
    address.address1.trim(),
    address.address2.trim(),
    address.landmark.trim(),
    address.city.trim(),
    address.pincode.trim(),
  ].filter(Boolean);
  return {
    line: parts.join(', '),
    state_name: address.state,
    state_code: address.state_code,
    godown: '',
  };
}

/** Project a Party (customer OR vendor) into the challan counterparty shape. */
function partyToChallanParty(party: Party): ChallanParty {
  return {
    party_id: party.id,
    name: party.company_name,
    gstin: party.gstin,
    pan: party.pan,
    phone: party.contact_no,
    contact_person: party.contact_person,
    address: toDocumentAddress(party.billing_address),
  };
}

/**
 * Delivery-Challan lifecycle use cases. Mirrors InvoiceService but the
 * counterparty is a Party (customer or vendor), there is no payment status, and
 * numbering uses a distinct prefix on the shared sequence. Owns transaction
 * boundaries via withImmediateTransaction (D-026); the numbering service and
 * repositories participate in the caller's transaction.
 */
export class ChallanService {
  constructor(
    private readonly db: Database.Database,
    private readonly challans: ChallanRepository,
    private readonly companies: CompanyRepository,
    private readonly parties: PartyRepository,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  get(id: string): Challan | null {
    return this.challans.get(id);
  }

  listSummaries(): Challan[] {
    return this.challans.listSummaries();
  }

  /** Create and persist a new draft with a fresh id, status DRAFT, no number. */
  createDraft(base?: Challan): Challan {
    const draft: Challan = {
      ...(base ?? this.emptyChallan()),
      id: this.ids(),
      status: InvoiceStatus.DRAFT,
      challan_number: null,
    };
    withImmediateTransaction(this.db, () => this.challans.save(draft));
    return draft;
  }

  /** Persist edits to a draft. */
  saveDraft(challan: Challan): Challan {
    if (challan.status !== InvoiceStatus.DRAFT) {
      throw new ChallanServiceError('save_draft is only valid for DRAFT challans');
    }
    if (challan.challan_number !== null) {
      throw new ChallanServiceError('a draft must not carry a challan number');
    }
    withImmediateTransaction(this.db, () => this.challans.save(challan));
    return challan;
  }

  /**
   * Finalize a draft atomically within one BEGIN IMMEDIATE transaction.
   * Flow: load draft -> validate -> resolve party/company -> determine tax type
   * -> calculate lines/tax/totals -> allocate DC number -> build snapshot ->
   * persist -> COMMIT. Any failure rolls back completely.
   */
  finalize(challanId: string, args: ChallanFinalizeArgs): Challan {
    const draft = this.challans.get(challanId);
    if (draft === null) throw new ChallanFinalizationError('challan not found');
    if (draft.status !== InvoiceStatus.DRAFT) {
      throw new ChallanFinalizationError('only a DRAFT challan can be finalized');
    }

    const { company, party } = this.resolveParties(draft);

    const issues = this.validateForFinalization(draft, party);
    if (issues.length) {
      throw new ChallanFinalizationError('challan failed finalization validation', issues);
    }

    const taxConfig = this.settings.getTaxRateConfig();
    const taxType = determineTaxType(
      company.address.state_code,
      draft.place_of_supply.state_code,
    );

    const { computedLines, taxInputs } = this.computeLines(draft.lines, taxType, taxConfig);
    const totals = calculateInvoiceTotals(taxInputs);
    const taxSummary = buildTaxSummary(taxInputs);
    const numberingConfig = this.challanNumberingConfig();

    const challanParty = partyToChallanParty(party);
    const shipTo = this.resolveShipTo(draft, party);

    return withImmediateTransaction(this.db, () => {
      const allocation = this.numbering.allocate(company.id, args.challanDate, numberingConfig);
      const snapshot: ChallanSnapshot = {
        company,
        direction: draft.direction,
        challan_type: draft.challan_type,
        party: challanParty,
        ship_to: shipTo,
        place_of_supply: draft.place_of_supply,
        reverse_charge: draft.reverse_charge,
        reason_for_eway: draft.reason_for_eway,
        delivery_mode: draft.delivery_mode,
        vehicle_no: draft.vehicle_no,
        lines: computedLines,
        totals,
        tax_summary: taxSummary,
        tax_rate_config: taxConfig,
        notes: draft.notes,
        terms: draft.terms,
        document_note: draft.document_note,
        grand_total_words: amountInWords(totals.grand_total),
        tax_amount_words: amountInWords(
          totals.total_cgst.plus(totals.total_sgst).plus(totals.total_igst),
        ),
      };
      const finalized: Challan = {
        ...draft,
        status: InvoiceStatus.FINALIZED,
        // The numbering service returns the formatted "DC/FY/NNN" string in
        // invoice_number (generic field); it's the challan number here.
        challan_number: allocation.invoice_number,
        challan_date: this.toIso(args.challanDate),
        company_id: company.id,
        party: challanParty,
        ship_to: shipTo,
        lines: computedLines,
        totals,
        template_version: DEFAULT_TEMPLATE_VERSION,
        snapshot,
      };
      this.challans.save(finalized);
      return finalized;
    });
  }

  /** Cancel a finalized challan, preserving the record and its number. */
  cancel(challanId: string, reason: string, when?: Date | null): Challan {
    const challan = this.challans.get(challanId);
    if (challan === null) throw new ChallanServiceError('challan not found');
    if (challan.status !== InvoiceStatus.FINALIZED) {
      throw new ChallanServiceError('only a FINALIZED challan can be cancelled');
    }
    const cancelled: Challan = {
      ...challan,
      status: InvoiceStatus.CANCELLED,
      cancelled_at: this.toIso(when ?? this.clock.now()),
      cancel_reason: reason,
    };
    withImmediateTransaction(this.db, () => this.challans.save(cancelled));
    return cancelled;
  }

  /** Duplicate a challan into a NEW draft (editable content only). */
  duplicate(challanId: string): Challan {
    const source = this.challans.get(challanId);
    if (source === null) throw new ChallanServiceError('challan not found');

    const copiedLines: ChallanLine[] = source.lines.map((line) => ({
      ...line,
      id: this.ids(),
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
    }));

    const duplicate: Challan = {
      ...this.emptyChallan(),
      id: this.ids(),
      status: InvoiceStatus.DRAFT,
      challan_number: null,
      direction: source.direction,
      challan_type: source.challan_type,
      company_id: source.company_id,
      party_id: source.party_id,
      party: source.party,
      ship_to: source.ship_to,
      place_of_supply: source.place_of_supply,
      reverse_charge: source.reverse_charge,
      reason_for_eway: source.reason_for_eway,
      delivery_mode: source.delivery_mode,
      vehicle_no: source.vehicle_no,
      lines: copiedLines,
      notes: source.notes,
      terms: source.terms,
      document_note: source.document_note,
    };
    withImmediateTransaction(this.db, () => this.challans.save(duplicate));
    return duplicate;
  }

  deleteDraft(challanId: string): void {
    withImmediateTransaction(this.db, () => this.challans.deleteDraft(challanId));
  }

  // --- helpers ---

  private challanNumberingConfig(): NumberingConfig {
    // Reuse the company's numbering width/scheme/start, but a distinct prefix so
    // challans get their own sequence within the shared invoice_sequences table.
    const base = this.settings.getNumberingConfig();
    return { ...base, prefix: CHALLAN_PREFIX };
  }

  private computeLines(
    lines: ChallanLine[],
    taxType: TaxType,
    taxConfig: ReturnType<SettingsService['getTaxRateConfig']>,
  ): { computedLines: ChallanLine[]; taxInputs: TaxLineInput[] } {
    const computedLines: ChallanLine[] = [];
    const taxInputs: TaxLineInput[] = [];
    for (const line of lines) {
      ensureSupportedTreatment(line.tax_treatment);
      const amounts = calculateLine(line.quantity, line.rate, line.discount_percent);
      const tax = calculateLineTax(amounts.taxable, taxType, taxConfig);
      computedLines.push({
        ...line,
        tax_rate: taxConfig.total_rate,
        taxable_amount: amounts.taxable,
        cgst_amount: tax.cgst,
        sgst_amount: tax.sgst,
        igst_amount: tax.igst,
      });
      taxInputs.push({
        hsn_sac: line.hsn_sac,
        tax_treatment: line.tax_treatment,
        tax_type: taxType,
        tax_rate: taxConfig.total_rate,
        taxable: amounts.taxable,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
      });
    }
    return { computedLines, taxInputs };
  }

  private resolveParties(challan: Challan): { company: Company; party: Party } {
    const company = this.companies.getActive();
    if (company === null) throw new ChallanServiceError('no active company is configured');
    if (challan.party_id === null) {
      throw new ChallanServiceError('challan has no party selected');
    }
    const party = this.parties.get(challan.party_id);
    if (party === null) throw new ChallanServiceError('selected party does not exist');
    return { company, party };
  }

  /** Ship-to defaults to the party's shipping address, falling back to billing. */
  private resolveShipTo(challan: Challan, party: Party): Address {
    // If the draft carries an explicit ship-to, keep it; else project from party.
    if (challan.ship_to.line.trim() || challan.ship_to.state_code.trim()) {
      return challan.ship_to;
    }
    const shipping = party.shipping_address ?? party.billing_address;
    return toDocumentAddress(shipping);
  }

  private validateForFinalization(challan: Challan, party: Party): string[] {
    const issues: string[] = [];
    if (!party.company_name.trim()) issues.push('Party name is required.');
    if (!challan.place_of_supply.state_code.trim()) {
      issues.push('Place of supply is required.');
    }
    const hasLine = challan.lines.some(
      (l) => l.description.trim() || l.quantity.greaterThan(0) || l.rate.greaterThan(0),
    );
    if (!hasLine) issues.push('At least one line item is required.');
    return issues;
  }

  private toIso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private emptyChallan(): Challan {
    return {
      id: '',
      challan_number: null,
      status: InvoiceStatus.DRAFT,
      direction: ChallanDirection.OUTWARD,
      challan_type: ChallanType.OTHER,
      challan_date: '',
      company_id: null,
      party_id: null,
      party: emptyChallanParty(),
      ship_to: { line: '', state_name: '', state_code: '', godown: '' },
      place_of_supply: { state_name: '', state_code: '' },
      reverse_charge: false,
      reason_for_eway: '',
      delivery_mode: '',
      vehicle_no: '',
      lines: [],
      totals: null as InvoiceTotals | null,
      notes: '',
      terms: '',
      document_note: '',
      template_version: null,
      snapshot: null,
      cancelled_at: '',
      cancel_reason: '',
    };
  }
}
