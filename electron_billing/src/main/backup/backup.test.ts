import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { TaxTreatment } from '@shared/domain/enums';
import { emptyAddress } from '@shared/domain/models';
import type { Company, Customer, InvoiceLine } from '@shared/domain/models';
import { connect } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { NumberingService } from '../app/numberingService';
import { SqliteSequenceRepository } from '../db/sequenceRepository';
import { MetadataReconciliationGate } from '../app/reconciliationGate';
import { ReconciliationPendingError } from '../app/numberingService';
import { ReconciliationService } from '../app/reconciliationService';
import { BackupService } from './backupService';

/**
 * Restore tests: safe backup creation + manifest, backup validation (hash),
 * restore with safety backup, numbering reconciliation blocking new issuance
 * until confirmed, and restore-failure recovery (bad hash rejected).
 */

let workDir: string;
let dbPath: string;
let app: Application;

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering',
    address: { line: 'X', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '',
    email: '',
    phone: '',
    bank_name: '',
    account_number: '',
    branch: '',
    ifsc: '',
    upi_id: '',
    authorized_signatory: '',
    logo_asset_id: null,
    signature_asset_id: null,
    active: true,
  };
}
function makeCustomer(): Customer {
  return {
    id: uuidv4(),
    name: 'DI-TECH',
    gstin: '',
    phone: '',
    email: '',
    bill_to: { line: '1', state_name: 'Karnataka', state_code: '29', godown: '' },
    ship_to: emptyAddress(),
    is_active: true,
  };
}
function line(): InvoiceLine {
  return {
    id: uuidv4(),
    sequence: 0,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: 'svc',
    specification: '',
    hsn_sac: '998898',
    quantity: new Money('1'),
    unit: 'NOS',
    rate: new Money('1000'),
    discount_percent: new Money('0'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}

function seedCompanyCustomer(a: Application): { company: Company; customer: Customer } {
  const company = makeCompany();
  a.companyRepo.save(company);
  const customer = makeCustomer();
  a.customerRepo.save(customer);
  return { company, customer };
}

function finalizeOne(a: Application, customerId: string): string {
  const draft = a.invoiceService.createDraft();
  a.invoiceService.saveDraft({
    ...draft,
    customer_id: customerId,
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    lines: [line()],
  });
  return a.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) }).invoice_number!;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'moulder-backup-'));
  dbPath = join(workDir, 'billing.sqlite3');
  app = buildApplicationFromDb(connect(dbPath));
});

afterEach(() => {
  app.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('backup create + validate', () => {
  it('creates a package with a manifest and passing hash', async () => {
    const { customer } = seedCompanyCustomer(app);
    finalizeOne(app, customer.id);

    const backups = join(workDir, 'backups');
    const svc = new BackupService('1.0.0', backups);
    const { backupDir, manifest } = await svc.create(app.db);

    expect(manifest.schemaVersion).toBeGreaterThan(0);
    expect(manifest.numberingHighWater.length).toBe(1);
    expect(manifest.numberingHighWater[0].high_water_mark).toBe(1);
    // Validation passes on an untampered package.
    await expect(svc.validate(backupDir)).resolves.toBeDefined();
  });

  it('rejects a tampered backup (hash mismatch) — restore-failure recovery', async () => {
    const { customer } = seedCompanyCustomer(app);
    finalizeOne(app, customer.id);
    const backups = join(workDir, 'backups');
    const svc = new BackupService('1.0.0', backups);
    const { backupDir } = await svc.create(app.db);
    // Corrupt the DB file.
    writeFileSync(join(backupDir, 'billing.sqlite3'), 'corrupted');
    await expect(svc.validate(backupDir)).rejects.toThrow(/integrity check failed/);
  });
});

describe('restore reconciliation blocks issuance until confirmed', () => {
  it('captures pre-restore high-water, blocks new numbers, then reconciles', async () => {
    // One business = one company/customer identity, shared across the current DB
    // and its older backup (realistic single-company product).
    const company = makeCompany();
    const customer = makeCustomer();

    // Build the OLDER backup first: same identities, only 1 invoice issued.
    const olderDbPath = join(workDir, 'older.sqlite3');
    const older = buildApplicationFromDb(connect(olderDbPath));
    older.companyRepo.save(company);
    older.customerRepo.save(customer);
    finalizeOne(older, customer.id); // high-water 1 in the older DB
    const backups = join(workDir, 'backups');
    const olderBackup = new BackupService('1.0.0', backups);
    const { backupDir } = await olderBackup.create(older.db);
    older.close();

    // Current DB: same identities, 3 invoices issued (high-water 3).
    app.companyRepo.save(company);
    app.customerRepo.save(customer);
    finalizeOne(app, customer.id);
    finalizeOne(app, customer.id);
    finalizeOne(app, customer.id);
    const c2 = customer;

    // Capture the CURRENT (trusted) high-water before restore.
    const trusted = app.db
      .prepare('SELECT company_id, financial_year, prefix, high_water_mark FROM invoice_sequences')
      .all() as { company_id: string; financial_year: string; prefix: string; high_water_mark: number }[];
    expect(trusted[0].high_water_mark).toBe(3);

    // Close live DB, restore the older backup over it.
    app.close();
    const restoreSvc = new BackupService('1.0.0', backups);
    await restoreSvc.restore(backupDir, dbPath, trusted);

    // Reopen: reconciliation is pending, so issuance is blocked.
    app = buildApplicationFromDb(connect(dbPath));
    const gate = new MetadataReconciliationGate(app.db);
    expect(gate.isReconciliationPending()).toBe(true);

    const seqRepo = new SqliteSequenceRepository(app.db);
    const blockedNumbering = new NumberingService(seqRepo, gate);
    expect(() =>
      blockedNumbering.allocate(trusted[0].company_id, new Date(2026, 5, 1), {
        prefix: 'SE',
        pad_width: 3,
        start_value: 1,
        fy_scheme: 'IN',
      }),
    ).toThrow(ReconciliationPendingError);

    // Reconcile: advances the scope past the trusted high-water (3) and unblocks.
    const recon = new ReconciliationService(app.db, new NumberingService(seqRepo, gate));
    expect(recon.isPending()).toBe(true);
    recon.reconcileAll();
    expect(recon.isPending()).toBe(false);

    // Next allocation is 004 (never reuses 001-003 that existed in the real world).
    const next = app.invoiceService.finalize(finalizeDraft(app, c2.id), {
      invoiceDate: new Date(2026, 5, 1),
    });
    expect(next.invoice_number).toBe('SE/26-27/004');
  });
});

/** Helper: create + save a draft, returning its id (customer must exist in the restored DB). */
function finalizeDraft(a: Application, customerId: string): string {
  // The restored (older) DB has its own company/customer; re-seed if absent.
  if (a.companyRepo.getActive() === null) {
    seedCompanyCustomer(a);
  }
  const activeCustomer = a.customerRepo.list()[0];
  const draft = a.invoiceService.createDraft();
  a.invoiceService.saveDraft({
    ...draft,
    customer_id: activeCustomer?.id ?? customerId,
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    lines: [line()],
  });
  return draft.id;
}
