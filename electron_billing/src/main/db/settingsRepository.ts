import type Database from 'better-sqlite3';
import { Money } from '@shared/domain/money';
import type { TaxRateConfig } from '@shared/domain/models';
import type { SettingsDefaults, SettingsRepository } from '@shared/domain/repositories';
import { DEFAULT_NUMBERING_CONFIG, type NumberingConfig } from '@shared/domain/numbering';
import { STANDARD_18 } from '@shared/domain/fixtures/golden';

/**
 * Key/value settings persisted as JSON in app_settings. Tax and numbering
 * configs default to the standard V1 values but are configurable (never
 * hardcoded 9/9 or 18 in the engine — DECISIONS D-030).
 */
const KEY_TAX = 'tax_rate_config';
const KEY_NUMBERING = 'numbering_config';
const KEY_DEFAULTS = 'document_defaults';

const DEFAULT_DEFAULTS: SettingsDefaults = {
  payment_terms: '',
  notes: '',
  terms: '',
  declaration:
    'We declare that this invoice shows the actual price of the goods/services described and that all particulars are true and correct.',
};

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  private read(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  private write(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getTaxRateConfig(): TaxRateConfig {
    const raw = this.read(KEY_TAX);
    if (!raw) return STANDARD_18;
    const o = JSON.parse(raw) as Record<string, string>;
    return {
      total_rate: new Money(o.total_rate),
      cgst_rate: new Money(o.cgst_rate),
      sgst_rate: new Money(o.sgst_rate),
      igst_rate: new Money(o.igst_rate),
    };
  }

  saveTaxRateConfig(config: TaxRateConfig): void {
    this.write(
      KEY_TAX,
      JSON.stringify({
        total_rate: config.total_rate.toString(),
        cgst_rate: config.cgst_rate.toString(),
        sgst_rate: config.sgst_rate.toString(),
        igst_rate: config.igst_rate.toString(),
      }),
    );
  }

  getNumberingConfig(): NumberingConfig {
    const raw = this.read(KEY_NUMBERING);
    if (!raw) return DEFAULT_NUMBERING_CONFIG;
    return JSON.parse(raw) as NumberingConfig;
  }

  saveNumberingConfig(config: NumberingConfig): void {
    this.write(KEY_NUMBERING, JSON.stringify(config));
  }

  getDefaults(): SettingsDefaults {
    const raw = this.read(KEY_DEFAULTS);
    if (!raw) return DEFAULT_DEFAULTS;
    return { ...DEFAULT_DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsDefaults>) };
  }

  saveDefaults(defaults: SettingsDefaults): void {
    this.write(KEY_DEFAULTS, JSON.stringify(defaults));
  }

  getFlag(key: string, fallback: boolean): boolean {
    const raw = this.read(`flag_${key}`);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  }

  setFlag(key: string, value: boolean): void {
    this.write(`flag_${key}`, value ? '1' : '0');
  }
}
