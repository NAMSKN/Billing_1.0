import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Platform-appropriate user-data paths (DECISIONS D-013). User data — the
 * database, backups, exports, assets, and logs — lives in the per-user app-data
 * directory, separate from the install directory, so upgrades never destroy
 * invoices. Paths are resolved through Electron's app.getPath rather than
 * hardcoded OS-specific strings.
 */
export interface AppPaths {
  dataDir: string;
  databaseFile: string;
  backupsDir: string;
  exportsDir: string;
  assetsDir: string;
  logsDir: string;
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function getAppPaths(): AppPaths {
  const base = ensureDir(join(app.getPath('userData'), 'MoulderBilling'));
  return {
    dataDir: base,
    databaseFile: join(base, 'billing.sqlite3'),
    backupsDir: ensureDir(join(base, 'backups')),
    exportsDir: ensureDir(join(base, 'exports')),
    assetsDir: ensureDir(join(base, 'assets')),
    logsDir: ensureDir(join(base, 'logs')),
  };
}
