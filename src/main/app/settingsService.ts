import type { TaxRateConfig } from '@shared/domain/models';
import type { SettingsDefaults, SettingsRepository } from '@shared/domain/repositories';
import type { NumberingConfig } from '@shared/domain/numbering';

/** Thin façade over the settings repository (tax/numbering/document defaults). */
export class SettingsService {
  constructor(private readonly settings: SettingsRepository) {}

  getTaxRateConfig(): TaxRateConfig {
    return this.settings.getTaxRateConfig();
  }
  saveTaxRateConfig(config: TaxRateConfig): void {
    this.settings.saveTaxRateConfig(config);
  }
  getNumberingConfig(): NumberingConfig {
    return this.settings.getNumberingConfig();
  }
  saveNumberingConfig(config: NumberingConfig): void {
    this.settings.saveNumberingConfig(config);
  }
  getDefaults(): SettingsDefaults {
    return this.settings.getDefaults();
  }
  saveDefaults(defaults: SettingsDefaults): void {
    this.settings.saveDefaults(defaults);
  }

  /** Inventory feature toggle (the "Inventory Option" switch). Default off. */
  isInventoryEnabled(): boolean {
    return this.settings.getFlag('inventory_enabled', false);
  }
  setInventoryEnabled(enabled: boolean): void {
    this.settings.setFlag('inventory_enabled', enabled);
  }
}
