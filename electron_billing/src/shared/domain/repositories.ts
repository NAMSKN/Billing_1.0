import type {
  Asset,
  Company,
  Customer,
  Invoice,
  SequenceState,
  TaxRateConfig,
} from './models';
import type { Challan } from './challan';
import type { NumberingConfig } from './numbering';

/**
 * Repository ports (interfaces). The domain/application layers depend on these,
 * not on concrete SQLite classes (architecture: dependencies point inward).
 * SQLite implementations live in the main process under src/main/db.
 */

export interface CompanyRepository {
  getActive(): Company | null;
  get(id: string): Company | null;
  save(company: Company): void;
}

export interface CustomerRepository {
  list(includeInactive?: boolean): Customer[];
  get(id: string): Customer | null;
  save(customer: Customer): void;
  archive(id: string): void;
}

export interface InvoiceRepository {
  get(id: string): Invoice | null;
  listSummaries(): Invoice[];
  save(invoice: Invoice): void;
  deleteDraft(id: string): void;
}

export interface ChallanRepository {
  get(id: string): Challan | null;
  listSummaries(): Challan[];
  save(challan: Challan): void;
  deleteDraft(id: string): void;
}

export interface SequenceRepository {
  get(companyId: string, financialYear: string, prefix: string): SequenceState | null;
  save(state: SequenceState): void;
}

export interface AssetRepository {
  get(id: string): Asset | null;
  save(asset: Asset): void;
}

export interface SettingsRepository {
  getTaxRateConfig(): TaxRateConfig;
  saveTaxRateConfig(config: TaxRateConfig): void;
  getNumberingConfig(): NumberingConfig;
  saveNumberingConfig(config: NumberingConfig): void;
  getDefaults(): SettingsDefaults;
  saveDefaults(defaults: SettingsDefaults): void;
  getFlag(key: string, fallback: boolean): boolean;
  setFlag(key: string, value: boolean): void;
}

export interface SettingsDefaults {
  payment_terms: string;
  notes: string;
  terms: string;
  declaration: string;
}
