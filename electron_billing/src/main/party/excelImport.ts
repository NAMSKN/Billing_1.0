import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import type Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';

// SheetJS's ESM build needs Node's fs bound explicitly for readFile.
XLSX.set_fs(fs);
import {
  BalanceType,
  PartyType,
  RegistrationType,
  INDIA,
  emptyPartyAddress,
  type OpeningBalance,
  type Party,
} from '@shared/domain/party';
import { validateParty } from '@shared/domain/partyValidation';
import type { PartyService, PartyInput } from '../app/partyService';
import { zeroBalance } from '../app/partyService';
import { COL, REQUIRED_IMPORT_HEADERS } from './excelColumns';

/**
 * Party Excel importer (faithful port). Two phases: buildPreview (parse +
 * validate + detect duplicates, no persistence) then commit (honor each
 * duplicate resolution). Error rows are never partially created.
 */

export type ImportAs = 'FILE' | 'CUSTOMER' | 'VENDOR' | 'CUSTOMER_VENDOR';
export type DuplicateResolution = 'UPDATE' | 'SKIP' | 'CREATE_NEW';

export interface ImportRow {
  row_number: number;
  data: PartyInput | null;
  errors: string[];
  duplicate_of_id: string | null;
  duplicate_of_name: string | null;
  resolution: DuplicateResolution;
}

export interface ImportPreview {
  header_errors: string[];
  rows: ImportRow[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

const TYPE_ALIASES: Record<string, PartyType> = {
  customer: PartyType.CUSTOMER,
  vendor: PartyType.VENDOR,
  'customer / vendor': PartyType.CUSTOMER_VENDOR,
  'customer/vendor': PartyType.CUSTOMER_VENDOR,
  'customer-vendor': PartyType.CUSTOMER_VENDOR,
  customer_vendor: PartyType.CUSTOMER_VENDOR,
  both: PartyType.CUSTOMER_VENDOR,
};

const REG_ALIASES: Record<string, RegistrationType> = {
  unregistered: RegistrationType.UNREGISTERED,
  regular: RegistrationType.REGULAR,
  'regular-sez': RegistrationType.REGULAR_SEZ,
  'regular sez': RegistrationType.REGULAR_SEZ,
  regular_sez: RegistrationType.REGULAR_SEZ,
  'regular-uin': RegistrationType.REGULAR_UIN,
  'regular uin': RegistrationType.REGULAR_UIN,
  regular_uin: RegistrationType.REGULAR_UIN,
};

const BALANCE_ALIASES: Record<string, BalanceType> = {
  debit: BalanceType.DEBIT,
  dr: BalanceType.DEBIT,
  credit: BalanceType.CREDIT,
  cr: BalanceType.CREDIT,
};

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function resolveCompanyType(value: unknown, importAs: ImportAs): [PartyType, string | null] {
  if (importAs === 'CUSTOMER') return [PartyType.CUSTOMER, null];
  if (importAs === 'VENDOR') return [PartyType.VENDOR, null];
  if (importAs === 'CUSTOMER_VENDOR') return [PartyType.CUSTOMER_VENDOR, null];
  const t = text(value);
  if (!t) return [PartyType.CUSTOMER, null];
  const resolved = TYPE_ALIASES[t.toLowerCase()];
  if (!resolved) return [PartyType.CUSTOMER, `Invalid Company Type: '${t}'.`];
  return [resolved, null];
}

function resolveRegistration(value: unknown): [RegistrationType, string | null] {
  const t = text(value);
  if (!t) return [RegistrationType.UNREGISTERED, null];
  const resolved = REG_ALIASES[t.toLowerCase()];
  if (!resolved) return [RegistrationType.UNREGISTERED, `Invalid Registration Type: '${t}'.`];
  return [resolved, null];
}

/**
 * Parse a money/number cell tolerantly. Real Excel data often carries currency
 * symbols and thousands separators (e.g. "₹12,500.00", "48,500.00"), so we
 * strip the rupee sign, commas, and surrounding whitespace before parsing.
 */
function parseOptionalDecimal(value: unknown, label: string): [Decimal | null, string | null] {
  const raw = text(value);
  if (!raw) return [null, null];
  const cleaned = raw.replace(/[\u20B9,\s]/g, '');
  if (!cleaned) return [null, null];
  try {
    const d = new Money(cleaned);
    if (!d.isFinite()) return [null, `${label} must be a number.`];
    return [d, null];
  } catch {
    return [null, `${label} must be a number.`];
  }
}

function parseOptionalInt(value: unknown, label: string): [number | null, string | null] {
  const t = text(value);
  if (!t) return [null, null];
  const n = Number(t);
  if (!Number.isInteger(n)) return [null, `${label} must be a whole number.`];
  return [n, null];
}

function parseBalance(
  typeValue: unknown,
  amountValue: unknown,
  label: string,
): [OpeningBalance, string[]] {
  const errors: string[] = [];
  let balanceType: BalanceType = BalanceType.DEBIT;
  const typeText = text(typeValue);
  if (typeText) {
    const resolved = BALANCE_ALIASES[typeText.toLowerCase()];
    if (!resolved) errors.push(`Invalid ${label} Type: '${typeText}'.`);
    else balanceType = resolved;
  }
  const [amount, amtErr] = parseOptionalDecimal(amountValue, `${label} Amount`);
  if (amtErr) errors.push(amtErr);
  return [{ balance_type: balanceType, amount: amount ?? new Money(0) }, errors];
}

export class PartyExcelImporter {
  constructor(private readonly service: PartyService) {}

  async buildPreview(filePath: string, importAs: ImportAs = 'FILE'): Promise<ImportPreview> {
    const preview: ImportPreview = { header_errors: [], rows: [] };

    // SheetJS reads real-world xlsx robustly (namespaced XML, Excel Tables,
    // pandas/openpyxl output) where stricter parsers fail.
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }

    // Rows as arrays; row 0 is the header. `defval: ''` keeps column alignment.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
    });
    if (matrix.length === 0) {
      preview.header_errors.push('The file is empty.');
      return preview;
    }

    const header = (matrix[0] as unknown[]).map((h) => text(h));
    const headerIndex = new Map<string, number>();
    header.forEach((name, i) => {
      if (name) headerIndex.set(name, i);
    });

    const missing = REQUIRED_IMPORT_HEADERS.filter((h) => !headerIndex.has(h));
    if (missing.length) {
      preview.header_errors.push(`Missing required column(s): ${missing.join(', ')}`);
      return preview;
    }

    for (let r = 1; r < matrix.length; r++) {
      const cells = matrix[r] as unknown[];
      if (isBlankRow(cells)) continue;
      const get = (col: string): unknown => {
        const idx = headerIndex.get(col);
        return idx === undefined ? null : (cells[idx] ?? null);
      };
      preview.rows.push(this.parseRow(r + 1, get, importAs));
    }
    return preview;
  }

  private parseRow(
    rowNumber: number,
    get: (col: string) => unknown,
    importAs: ImportAs,
  ): ImportRow {
    const errors: string[] = [];
    const [companyType, typeErr] = resolveCompanyType(get(COL.COMPANY_TYPE), importAs);
    if (typeErr) errors.push(typeErr);
    const [registration, regErr] = resolveRegistration(get(COL.REGISTRATION_TYPE));
    if (regErr) errors.push(regErr);
    const [distance, distErr] = parseOptionalDecimal(get(COL.EWAY_DISTANCE), 'E-Way Bill distance');
    if (distErr) errors.push(distErr);
    const [dueDays, dueErr] = parseOptionalInt(get(COL.DUE_DAYS), 'Due Days');
    if (dueErr) errors.push(dueErr);
    const [custBalance, cbErr] = parseBalance(
      get(COL.CUST_BAL_TYPE),
      get(COL.CUST_BAL_AMOUNT),
      'Customer Balance',
    );
    errors.push(...cbErr);
    const [vendBalance, vbErr] = parseBalance(
      get(COL.VENDOR_BAL_TYPE),
      get(COL.VENDOR_BAL_AMOUNT),
      'Vendor Balance',
    );
    errors.push(...vbErr);

    const country = text(get(COL.COUNTRY)) || INDIA;
    const data: PartyInput = {
      company_type: companyType,
      company_name: text(get(COL.NAME)),
      contact_person: text(get(COL.CONTACT_PERSON)),
      contact_no: text(get(COL.CONTACT_NO)),
      email: text(get(COL.EMAIL)),
      registration_type: registration,
      gstin: text(get(COL.GSTIN)).toUpperCase(),
      pan: text(get(COL.PAN)).toUpperCase(),
      billing_address: {
        ...emptyPartyAddress(),
        address1: text(get(COL.ADDRESS1)),
        address2: text(get(COL.ADDRESS2)),
        landmark: text(get(COL.LANDMARK)),
        country,
        state: text(get(COL.STATE)),
        state_code: '',
        city: text(get(COL.CITY)),
        pincode: text(get(COL.PINCODE)),
      },
      shipping_address: null,
      distance_for_eway_bill_km: distance,
      group_id: null,
      bank_name: text(get(COL.BANK_NAME)),
      bank_ifsc_code: text(get(COL.BANK_IFSC)).toUpperCase(),
      bank_account_number: text(get(COL.BANK_ACCOUNT)),
      fax_no: text(get(COL.FAX)),
      website: text(get(COL.WEBSITE)),
      credit_limit: null,
      due_days: dueDays,
      note: text(get(COL.NOTE)),
      visible_on_documents: false,
      custom_field_1: text(get(COL.CUSTOM1)),
      custom_field_2: text(get(COL.CUSTOM2)),
      custom_field_3: text(get(COL.CUSTOM3)),
      customer_balance: custBalance,
      vendor_balance: vendBalance,
    };

    // Domain-rule validation.
    errors.push(...validateParty(inputToParty(data)));

    const importRow: ImportRow = {
      row_number: rowNumber,
      data: errors.length ? null : data,
      errors,
      duplicate_of_id: null,
      duplicate_of_name: null,
      resolution: 'CREATE_NEW',
    };
    if (!errors.length) {
      const dup = this.service.findDuplicate(data);
      if (dup) {
        importRow.duplicate_of_id = dup.id;
        importRow.duplicate_of_name = dup.company_name;
        importRow.resolution = 'SKIP';
      }
    }
    return importRow;
  }

  commit(preview: ImportPreview): ImportResult {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0 };
    for (const row of preview.rows) {
      if (!row.data) continue;
      if (row.duplicate_of_id) {
        if (row.resolution === 'SKIP') {
          result.skipped++;
          continue;
        }
        if (row.resolution === 'UPDATE') {
          this.service.updateParty(row.duplicate_of_id, row.data, true);
          result.updated++;
          continue;
        }
      }
      this.service.createParty(row.data);
      result.created++;
    }
    return result;
  }
}

function isBlankRow(cells: unknown[]): boolean {
  return cells.every((v) => text(v) === '');
}

/** Build a Party shape from a PartyInput for validation only. */
function inputToParty(data: PartyInput): Party {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    company_type: data.company_type,
    company_name: data.company_name,
    contact_person: data.contact_person,
    contact_no: data.contact_no,
    email: data.email,
    registration_type: data.registration_type,
    gstin: data.gstin,
    pan: data.pan,
    billing_address: data.billing_address,
    shipping_address: data.shipping_address,
    distance_for_eway_bill_km: data.distance_for_eway_bill_km,
    group_id: data.group_id,
    bank_name: data.bank_name,
    bank_ifsc_code: data.bank_ifsc_code,
    bank_account_number: data.bank_account_number,
    fax_no: data.fax_no,
    website: data.website,
    credit_limit: data.credit_limit,
    due_days: data.due_days,
    note: data.note,
    visible_on_documents: data.visible_on_documents,
    custom_field_1: data.custom_field_1,
    custom_field_2: data.custom_field_2,
    custom_field_3: data.custom_field_3,
    customer_balance: data.customer_balance,
    vendor_balance: data.vendor_balance,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

export { zeroBalance };
