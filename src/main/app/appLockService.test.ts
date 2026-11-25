import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyPending } from '../db/migrations';
import { AppLockService } from './appLockService';

describe('AppLockService', () => {
  let db: Database.Database;
  let service: AppLockService;

  beforeEach(() => {
    db = new Database(':memory:');
    applyPending(db);
    service = new AppLockService(db);
  });

  it('starts disabled by default', () => {
    const status = service.getStatus();
    expect(status.enabled).toBe(false);
    expect(service.verifyPin('1234')).toBe(true);
  });

  it('sets and verifies correct PIN', () => {
    service.setPin('1234');
    const status = service.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.length).toBe(4);

    expect(service.verifyPin('1234')).toBe(true);
    expect(service.verifyPin('9999')).toBe(false);
  });

  it('disables PIN protection cleanly', () => {
    service.setPin('5678');
    expect(service.getStatus().enabled).toBe(true);

    service.disable();
    expect(service.getStatus().enabled).toBe(false);
    expect(service.verifyPin('5678')).toBe(true);
  });

  it('rejects invalid PIN formats', () => {
    expect(() => service.setPin('abc')).toThrow();
    expect(() => service.setPin('12')).toThrow();
  });
});
