import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Safe backup/restore with numbering reconciliation (DECISIONS D-018, D-029).
 *
 * Backup uses SQLite's online backup API (better-sqlite3's db.backup) — never a
 * raw file copy while writes may occur. A backup is a package: the .sqlite3
 * file plus a manifest.json carrying the schema/app version, a SHA-256 integrity
 * hash, and the CURRENT (pre-existing) numbering high-water state.
 *
 * Restore is staged: validate the package + hash, capture the CURRENT database's
 * trusted numbering high-water marks, take a safety backup of the current DB,
 * replace the DB, then enter RECONCILIATION_PENDING and reconcile each numbering
 * scope to at least the pre-restore trusted high-water + 1 before issuance is
 * allowed. The pre-restore state — not the older backup's mark — is authoritative.
 */

export interface BackupManifest {
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  databaseFile: string;
  sha256: string;
  numberingHighWater: TrustedScope[];
}

export interface TrustedScope {
  company_id: string;
  financial_year: string;
  prefix: string;
  high_water_mark: number;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get() as { v: number };
  return row.v;
}

function readNumberingScopes(db: Database.Database): TrustedScope[] {
  return db
    .prepare(
      'SELECT company_id, financial_year, prefix, high_water_mark FROM invoice_sequences',
    )
    .all() as TrustedScope[];
}

export class BackupService {
  constructor(
    private readonly appVersion: string,
    private readonly backupsDir: string,
  ) {}

  /**
   * Create a validated backup package from the LIVE database using SQLite's
   * online backup. Returns the manifest path. The backup is consistent even if
   * writes are in flight.
   */
  async create(db: Database.Database): Promise<{ backupDir: string; manifest: BackupManifest }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.backupsDir, `backup-${stamp}`);
    await mkdir(backupDir, { recursive: true });

    const dbTarget = join(backupDir, 'billing.sqlite3');
    // SQLite online backup — safe concurrent snapshot.
    await db.backup(dbTarget);

    const manifest: BackupManifest = {
      appVersion: this.appVersion,
      schemaVersion: readSchemaVersion(db),
      createdAt: new Date().toISOString(),
      databaseFile: 'billing.sqlite3',
      sha256: await sha256File(dbTarget),
      numberingHighWater: readNumberingScopes(db),
    };
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { backupDir, manifest };
  }

  /** Validate a backup package: manifest present + DB hash matches. */
  async validate(backupDir: string): Promise<BackupManifest> {
    const manifestPath = join(backupDir, 'manifest.json');
    if (!existsSync(manifestPath)) throw new Error('backup manifest is missing');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
    const dbPath = join(backupDir, manifest.databaseFile);
    if (!existsSync(dbPath)) throw new Error('backup database file is missing');
    const actual = await sha256File(dbPath);
    if (actual !== manifest.sha256) throw new Error('backup integrity check failed (hash mismatch)');
    return manifest;
  }

  /**
   * Restore staged. The live DB is closed by the caller BEFORE this runs.
   * `currentDbPath` is the live path; `trustedScopes` are captured from the
   * current DB before replacement (D-029). Steps: validate -> safety-backup the
   * current DB -> replace -> mark RECONCILIATION_PENDING + persist trusted state.
   * Returns the safety-backup path so the caller can recover on failure.
   */
  async restore(
    backupDir: string,
    currentDbPath: string,
    trustedScopes: TrustedScope[],
  ): Promise<{ safetyBackupDir: string }> {
    const manifest = await this.validate(backupDir);

    // 1. Safety backup of the CURRENT database (raw copy is safe: DB is closed).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyBackupDir = join(this.backupsDir, `safety-${stamp}`);
    await mkdir(safetyBackupDir, { recursive: true });
    if (existsSync(currentDbPath)) {
      await copyFile(currentDbPath, join(safetyBackupDir, 'billing.sqlite3'));
    }

    // 2. Replace the live DB with the backup copy.
    const backupDbPath = join(backupDir, manifest.databaseFile);
    await copyFile(backupDbPath, currentDbPath);
    // Remove stale WAL/SHM so the restored DB is read cleanly on reopen.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = currentDbPath + suffix;
      if (existsSync(sidecar)) await import('node:fs/promises').then((fs) => fs.rm(sidecar));
    }

    // 3. Reopen and mark RECONCILIATION_PENDING with the pre-restore trusted state.
    const restored = new Database(currentDbPath);
    try {
      restored.pragma('foreign_keys = ON');
      restored
        .prepare(
          `INSERT INTO restore_metadata (id, reconciliation_pending, trusted_state_json)
           VALUES (1, 1, @json)
           ON CONFLICT(id) DO UPDATE SET reconciliation_pending = 1, trusted_state_json = @json`,
        )
        .run({ json: JSON.stringify(trustedScopes) });
    } finally {
      restored.close();
    }

    return { safetyBackupDir };
  }

  /** List available backups (most recent first). */
  async list(): Promise<string[]> {
    if (!existsSync(this.backupsDir)) return [];
    const entries = await readdir(this.backupsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && basename(e.name).startsWith('backup-'))
      .map((e) => join(this.backupsDir, e.name))
      .sort()
      .reverse();
  }
}
