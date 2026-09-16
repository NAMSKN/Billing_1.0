import type Database from 'better-sqlite3';
import type { Company } from '@shared/domain/models';
import type { CompanyRepository } from '@shared/domain/repositories';
import { boolToInt, intToBool, parseUuid, toCanonicalUuid } from './mappers';

interface CompanyRow {
  id: string;
  name: string;
  address_line: string;
  state_name: string;
  state_code: string;
  gstin: string;
  email: string;
  phone: string;
  bank_name: string;
  account_number: string;
  branch: string;
  ifsc: string;
  upi_id: string;
  authorized_signatory: string;
  logo_asset_id: string | null;
  signature_asset_id: string | null;
  active: number;
}

function rowToCompany(row: CompanyRow): Company {
  return {
    id: toCanonicalUuid(row.id),
    name: row.name,
    address: {
      line: row.address_line,
      state_name: row.state_name,
      state_code: row.state_code,
      godown: '',
    },
    gstin: row.gstin,
    email: row.email,
    phone: row.phone,
    bank_name: row.bank_name,
    account_number: row.account_number,
    branch: row.branch,
    ifsc: row.ifsc,
    upi_id: row.upi_id,
    authorized_signatory: row.authorized_signatory,
    logo_asset_id: parseUuid(row.logo_asset_id),
    signature_asset_id: parseUuid(row.signature_asset_id),
    active: intToBool(row.active),
  };
}

export class SqliteCompanyRepository implements CompanyRepository {
  constructor(private readonly db: Database.Database) {}

  getActive(): Company | null {
    const row = this.db
      .prepare('SELECT * FROM companies WHERE active = 1 LIMIT 1')
      .get() as CompanyRow | undefined;
    return row ? rowToCompany(row) : null;
  }

  get(id: string): Company | null {
    const row = this.db
      .prepare('SELECT * FROM companies WHERE id = ?')
      .get(toCanonicalUuid(id)) as CompanyRow | undefined;
    return row ? rowToCompany(row) : null;
  }

  save(company: Company): void {
    // Upsert via ON CONFLICT so a re-save updates in place without clobbering
    // unrelated rows.
    this.db
      .prepare(
        `INSERT INTO companies (
           id, name, address_line, state_name, state_code, gstin, email, phone,
           bank_name, account_number, branch, ifsc, upi_id, authorized_signatory,
           logo_asset_id, signature_asset_id, active
         ) VALUES (
           @id, @name, @address_line, @state_name, @state_code, @gstin, @email, @phone,
           @bank_name, @account_number, @branch, @ifsc, @upi_id, @authorized_signatory,
           @logo_asset_id, @signature_asset_id, @active
         )
         ON CONFLICT(id) DO UPDATE SET
           name=@name, address_line=@address_line, state_name=@state_name,
           state_code=@state_code, gstin=@gstin, email=@email, phone=@phone,
           bank_name=@bank_name, account_number=@account_number, branch=@branch,
           ifsc=@ifsc, upi_id=@upi_id, authorized_signatory=@authorized_signatory,
           logo_asset_id=@logo_asset_id, signature_asset_id=@signature_asset_id,
           active=@active`,
      )
      .run({
        id: toCanonicalUuid(company.id),
        name: company.name,
        address_line: company.address.line,
        state_name: company.address.state_name,
        state_code: company.address.state_code,
        gstin: company.gstin,
        email: company.email,
        phone: company.phone,
        bank_name: company.bank_name,
        account_number: company.account_number,
        branch: company.branch,
        ifsc: company.ifsc,
        upi_id: company.upi_id,
        authorized_signatory: company.authorized_signatory,
        logo_asset_id: company.logo_asset_id ? toCanonicalUuid(company.logo_asset_id) : null,
        signature_asset_id: company.signature_asset_id
          ? toCanonicalUuid(company.signature_asset_id)
          : null,
        active: boolToInt(company.active),
      });
  }
}
