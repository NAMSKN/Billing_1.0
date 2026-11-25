import type Database from 'better-sqlite3';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

export interface AppLockStatus {
  enabled: boolean;
  length: number;
}

export class AppLockService {
  constructor(private readonly db: Database.Database) {}

  getStatus(): AppLockStatus {
    const row = this.db
      .prepare('SELECT enabled, pin_length FROM app_security WHERE id = 1')
      .get() as { enabled: number; pin_length: number } | undefined;

    return {
      enabled: Boolean(row?.enabled),
      length: row?.pin_length || 4,
    };
  }

  setPin(pin: string): void {
    const clean = pin.trim();
    if (!/^\d{4,8}$/.test(clean)) {
      throw new Error('PIN must be 4 to 8 digits');
    }

    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(clean, salt, 10000, 32, 'sha256').toString('hex');

    this.db
      .prepare(
        `UPDATE app_security
         SET pin_hash = ?, salt = ?, enabled = 1, pin_length = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(hash, salt, clean.length, new Date().toISOString());
  }

  disable(): void {
    this.db
      .prepare(
        `UPDATE app_security
         SET enabled = 0, updated_at = ?
         WHERE id = 1`,
      )
      .run(new Date().toISOString());
  }

  verifyPin(inputPin: string): boolean {
    const row = this.db
      .prepare('SELECT pin_hash, salt, enabled FROM app_security WHERE id = 1')
      .get() as { pin_hash: string; salt: string; enabled: number } | undefined;

    if (!row || !row.enabled) return true; // No active lock
    if (!row.pin_hash || !row.salt) return false;

    const hash = pbkdf2Sync(inputPin.trim(), row.salt, 10000, 32, 'sha256').toString('hex');
    return hash === row.pin_hash;
  }
}
