import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';

XLSX.set_fs(fs);
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { PartyExcelImporter } from './excelImport';
import { PartyExcelExporter } from './excelExport';
import { COL, EXPORT_COLUMNS } from './excelColumns';

let db: Database.Database;
let app: Application;
let workDir: string;

beforeEach(() => {
  db = connectMemory();
  app = buildApplicationFromDb(db);
  workDir = mkdtempSync(join(tmpdir(), 'party-xlsx-'));
});
afterEach(() => {
  app.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** Write an xlsx with the given header + data rows (arrays keyed by header). */
async function writeXlsx(headers: string[], rows: Record<string, unknown>[]): Promise<string> {
  const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Parties');
  const path = join(workDir, 'in.xlsx');
  XLSX.writeFile(wb, path, { bookType: 'xlsx' });
  return path;
}

describe('Excel import', () => {
  it('imports valid rows, defaults company type to Customer', async () => {
    const path = await writeXlsx([COL.NAME, COL.STATE, COL.CITY], [
      { [COL.NAME]: 'Alpha Ltd', [COL.STATE]: 'Karnataka', [COL.CITY]: 'Bengaluru' },
      { [COL.NAME]: 'Beta Corp', [COL.STATE]: 'Kerala', [COL.CITY]: 'Kochi' },
    ]);
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path, 'FILE');
    expect(preview.header_errors).toEqual([]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every((r) => r.errors.length === 0)).toBe(true);

    const result = importer.commit(preview);
    expect(result.created).toBe(2);
    expect(app.partyService.list(null, false)).toHaveLength(2);
  });

  it('reports header error when the required name column is missing', async () => {
    const path = await writeXlsx([COL.CITY], [{ [COL.CITY]: 'X' }]);
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path);
    expect(preview.header_errors[0]).toContain('Missing required column');
  });

  it('flags a row with an India address missing state/city', async () => {
    const path = await writeXlsx([COL.NAME, COL.ADDRESS1], [
      { [COL.NAME]: 'NoState Ltd', [COL.ADDRESS1]: '1 Road' },
    ]);
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path);
    expect(preview.rows[0].errors.length).toBeGreaterThan(0);
    expect(preview.rows[0].data).toBeNull();
    // Committing an error row creates nothing.
    expect(importer.commit(preview).created).toBe(0);
  });

  it('detects a duplicate by GSTIN and skips by default', async () => {
    // Seed an existing party.
    app.partyService.createParty({
      company_type: 'CUSTOMER',
      company_name: 'Existing',
      contact_person: '',
      contact_no: '',
      email: '',
      registration_type: 'REGULAR',
      gstin: '29ABCDE1234F1Z5',
      pan: '',
      billing_address: { address1: '', address2: '', landmark: '', country: 'India', state: 'Karnataka', state_code: '29', city: 'Bengaluru', pincode: '' },
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
      customer_balance: { balance_type: 'DEBIT', amount: new Money(0) },
      vendor_balance: { balance_type: 'DEBIT', amount: new Money(0) },
    });

    const path = await writeXlsx(
      [COL.NAME, COL.STATE, COL.CITY, COL.REGISTRATION_TYPE, COL.GSTIN],
      [{ [COL.NAME]: 'Dup', [COL.STATE]: 'Karnataka', [COL.CITY]: 'Bengaluru', [COL.REGISTRATION_TYPE]: 'Regular', [COL.GSTIN]: '29ABCDE1234F1Z5' }],
    );
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path);
    expect(preview.rows[0].duplicate_of_id).not.toBeNull();
    expect(preview.rows[0].resolution).toBe('SKIP');
    const result = importer.commit(preview);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it('tolerates currency symbols and thousands separators in amounts', async () => {
    const path = await writeXlsx(
      [COL.NAME, COL.STATE, COL.CITY, COL.CUST_BAL_TYPE, COL.CUST_BAL_AMOUNT],
      [
        {
          [COL.NAME]: 'Formatted Amt Ltd',
          [COL.STATE]: 'Karnataka',
          [COL.CITY]: 'Bengaluru',
          [COL.CUST_BAL_TYPE]: 'Credit',
          [COL.CUST_BAL_AMOUNT]: '\u20B912,500.00',
        },
      ],
    );
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path);
    expect(preview.rows[0].errors).toEqual([]);
    importer.commit(preview);
    const saved = app.partyService.list(null, false).find((p) => p.company_name === 'Formatted Amt Ltd');
    expect(saved!.customer_balance.amount.toFixed(2)).toBe('12500.00');
  });

  it('ImportAs override forces the company type', async () => {
    const path = await writeXlsx([COL.NAME, COL.STATE, COL.CITY], [
      { [COL.NAME]: 'Forced Vendor', [COL.STATE]: 'Karnataka', [COL.CITY]: 'Bengaluru' },
    ]);
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path, 'VENDOR');
    importer.commit(preview);
    const vendors = app.partyService.list('VENDOR', false);
    expect(vendors.map((p) => p.company_name)).toContain('Forced Vendor');
  });
});

describe('Excel export', () => {
  it('exports the 31-column schema with a header row', async () => {
    app.partyService.createParty({
      company_type: 'CUSTOMER_VENDOR',
      company_name: 'Roundtrip Co',
      contact_person: 'Ravi',
      contact_no: '9999999999',
      email: '',
      registration_type: 'UNREGISTERED',
      gstin: '',
      pan: '',
      billing_address: { address1: 'A', address2: '', landmark: '', country: 'India', state: 'Karnataka', state_code: '29', city: 'Bengaluru', pincode: '' },
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
      customer_balance: { balance_type: 'CREDIT', amount: new Money('12500.00') },
      vendor_balance: { balance_type: 'DEBIT', amount: new Money('0') },
    });

    const exporter = new PartyExcelExporter(app.partyService, app.partyGroupService);
    const out = join(workDir, 'out.xlsx');
    await exporter.export('BOTH', out, false);

    const wb = XLSX.readFile(out);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    expect(matrix[0] as string[]).toEqual(EXPORT_COLUMNS);
    expect(matrix.length).toBe(2); // header + 1 party
    const dataRow = matrix[1] as string[];
    expect(dataRow).toContain('Roundtrip Co');
    expect(dataRow).toContain('12500.00');
  });

  it('reads a namespaced/openpyxl-style workbook (regression for the sheets error)', async () => {
    // Simulates the failing file: x:-prefixed XML with an Excel table. SheetJS
    // reads it; the previous parser threw "reading 'sheets'".
    const path = await writeXlsx([COL.NAME, COL.STATE, COL.CITY, COL.COMPANY_TYPE], [
      { [COL.NAME]: 'Namespaced Ltd', [COL.STATE]: 'Karnataka', [COL.CITY]: 'Bengaluru', [COL.COMPANY_TYPE]: 'Customer / Vendor' },
    ]);
    const importer = new PartyExcelImporter(app.partyService);
    const preview = await importer.buildPreview(path, 'FILE');
    expect(preview.header_errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].errors).toEqual([]);
  });
});
