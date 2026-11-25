import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { BALANCE_TYPE_LABEL, REGISTRATION_TYPE_LABEL } from '@shared/domain/party';

// SheetJS's ESM build needs Node's fs bound explicitly for writeFile/readFile.
XLSX.set_fs(fs);
import { isCustomerType, isVendorType, type Party } from '@shared/domain/party';
import type { PartyService } from '../app/partyService';
import type { PartyGroupService } from '../app/partyGroupService';
import { COL, EXPORT_COLUMNS } from './excelColumns';

export type ExportScope = 'CUSTOMERS' | 'VENDORS' | 'BOTH';

/**
 * Party Excel exporter using SheetJS. Writes a single "Parties" sheet with the
 * 31-column schema, one row per party in the chosen scope. company_type is
 * written as its stored value; registration/balance types as labels; the
 * internal UUID is never written. SheetJS is tolerant of the same namespaced
 * XLSX files the importer must read.
 */
export class PartyExcelExporter {
  constructor(
    private readonly parties: PartyService,
    private readonly groups: PartyGroupService,
  ) {}

  private selectForScope(scope: ExportScope, includeArchived: boolean): Party[] {
    const all = this.parties.list(null, includeArchived);
    if (scope === 'CUSTOMERS') return all.filter((p) => isCustomerType(p.company_type));
    if (scope === 'VENDORS') return all.filter((p) => isVendorType(p.company_type));
    return all;
  }

  async export(scope: ExportScope, filePath: string, includeArchived: boolean): Promise<string> {
    const groupNames = new Map(this.groups.listGroups(true).map((g) => [g.id, g.name]));
    const rows = this.selectForScope(scope, includeArchived).map((p) => this.rowFor(p, groupNames));

    // Array-of-objects keyed by the exact column headers, in the fixed order.
    const sheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Parties');
    XLSX.writeFile(workbook, filePath, { bookType: 'xlsx' });
    return filePath;
  }

  private rowFor(p: Party, groupNames: Map<string, string>): Record<string, string | number> {
    return {
      [COL.NAME]: p.company_name,
      [COL.CONTACT_PERSON]: p.contact_person,
      [COL.CONTACT_NO]: p.contact_no,
      [COL.ADDRESS1]: p.billing_address.address1,
      [COL.ADDRESS2]: p.billing_address.address2,
      [COL.LANDMARK]: p.billing_address.landmark,
      [COL.COUNTRY]: p.billing_address.country,
      [COL.STATE]: p.billing_address.state,
      [COL.CITY]: p.billing_address.city,
      [COL.COMPANY_TYPE]: p.company_type,
      [COL.BANK_NAME]: p.bank_name,
      [COL.BANK_IFSC]: p.bank_ifsc_code,
      [COL.BANK_ACCOUNT]: p.bank_account_number,
      [COL.PINCODE]: p.billing_address.pincode,
      [COL.FAX]: p.fax_no,
      [COL.WEBSITE]: p.website,
      [COL.EMAIL]: p.email,
      [COL.REGISTRATION_TYPE]: REGISTRATION_TYPE_LABEL[p.registration_type],
      [COL.GSTIN]: p.gstin,
      [COL.PAN]: p.pan,
      [COL.EWAY_DISTANCE]: p.distance_for_eway_bill_km ? p.distance_for_eway_bill_km.toString() : '',
      [COL.GROUP]: p.group_id ? (groupNames.get(p.group_id) ?? '') : '',
      [COL.CUSTOM1]: p.custom_field_1,
      [COL.CUSTOM2]: p.custom_field_2,
      [COL.CUSTOM3]: p.custom_field_3,
      [COL.DUE_DAYS]: p.due_days ?? '',
      [COL.NOTE]: p.note,
      [COL.CUST_BAL_TYPE]: BALANCE_TYPE_LABEL[p.customer_balance.balance_type],
      [COL.CUST_BAL_AMOUNT]: p.customer_balance.amount.toFixed(2),
      [COL.VENDOR_BAL_TYPE]: BALANCE_TYPE_LABEL[p.vendor_balance.balance_type],
      [COL.VENDOR_BAL_AMOUNT]: p.vendor_balance.amount.toFixed(2),
    };
  }
}
