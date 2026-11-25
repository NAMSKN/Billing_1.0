import { Money, formatMoney } from '@shared/domain/money';
import {
  PARTY_TYPE_LABEL,
  isCustomerType,
  isVendorType,
  type OpeningBalance,
  type Party,
  type PartyAddress,
  type PartyGroup,
} from '@shared/domain/party';
import type {
  OpeningBalanceDto,
  PartyAddressDto,
  PartyDto,
  PartyGroupDto,
} from '@shared/partyDto';
import type { PartyInput } from './partyService';

/** Party <-> wire DTO conversions. Money crosses as decimal strings. */

function balanceToDto(b: OpeningBalance): OpeningBalanceDto {
  return { balance_type: b.balance_type, amount: b.amount.toFixed(2) };
}
function balanceFromDto(d: OpeningBalanceDto): OpeningBalance {
  return { balance_type: d.balance_type, amount: new Money(d.amount || '0') };
}

function addressToDto(a: PartyAddress): PartyAddressDto {
  return { ...a };
}
function addressFromDto(d: PartyAddressDto): PartyAddress {
  return { ...d };
}

/** The list "Balance" cell: "C: ₹12,500.00 Cr  V: ₹32,500.00 Dr". */
function balanceSummary(p: Party): string {
  const parts: string[] = [];
  const signed = (b: OpeningBalance) =>
    `\u20B9${formatMoney(b.amount)} ${b.balance_type === 'DEBIT' ? 'Dr' : 'Cr'}`;
  if (isCustomerType(p.company_type) && !p.customer_balance.amount.isZero()) {
    parts.push(`C: ${signed(p.customer_balance)}`);
  }
  if (isVendorType(p.company_type) && !p.vendor_balance.amount.isZero()) {
    parts.push(`V: ${signed(p.vendor_balance)}`);
  }
  return parts.join('  ');
}

export function partyToDto(p: Party): PartyDto {
  return {
    id: p.id,
    company_type: p.company_type,
    company_name: p.company_name,
    contact_person: p.contact_person,
    contact_no: p.contact_no,
    email: p.email,
    registration_type: p.registration_type,
    gstin: p.gstin,
    pan: p.pan,
    billing_address: addressToDto(p.billing_address),
    shipping_address: p.shipping_address ? addressToDto(p.shipping_address) : null,
    distance_for_eway_bill_km: p.distance_for_eway_bill_km
      ? p.distance_for_eway_bill_km.toString()
      : null,
    group_id: p.group_id,
    bank_name: p.bank_name,
    bank_ifsc_code: p.bank_ifsc_code,
    bank_account_number: p.bank_account_number,
    fax_no: p.fax_no,
    website: p.website,
    credit_limit: p.credit_limit ? p.credit_limit.toFixed(2) : null,
    due_days: p.due_days,
    note: p.note,
    visible_on_documents: p.visible_on_documents,
    custom_field_1: p.custom_field_1,
    custom_field_2: p.custom_field_2,
    custom_field_3: p.custom_field_3,
    customer_balance: balanceToDto(p.customer_balance),
    vendor_balance: balanceToDto(p.vendor_balance),
    is_active: p.is_active,
    created_at: p.created_at,
    updated_at: p.updated_at,
    balance_summary: balanceSummary(p),
  };
}

export function partyInputFromDto(d: PartyDto): PartyInput {
  return {
    company_type: d.company_type,
    company_name: d.company_name,
    contact_person: d.contact_person,
    contact_no: d.contact_no,
    email: d.email,
    registration_type: d.registration_type,
    gstin: d.gstin,
    pan: d.pan,
    billing_address: addressFromDto(d.billing_address),
    shipping_address: d.shipping_address ? addressFromDto(d.shipping_address) : null,
    distance_for_eway_bill_km: d.distance_for_eway_bill_km
      ? new Money(d.distance_for_eway_bill_km)
      : null,
    group_id: d.group_id,
    bank_name: d.bank_name,
    bank_ifsc_code: d.bank_ifsc_code,
    bank_account_number: d.bank_account_number,
    fax_no: d.fax_no,
    website: d.website,
    credit_limit: d.credit_limit ? new Money(d.credit_limit) : null,
    due_days: d.due_days,
    note: d.note,
    visible_on_documents: d.visible_on_documents,
    custom_field_1: d.custom_field_1,
    custom_field_2: d.custom_field_2,
    custom_field_3: d.custom_field_3,
    customer_balance: balanceFromDto(d.customer_balance),
    vendor_balance: balanceFromDto(d.vendor_balance),
  };
}

export function groupToDto(g: PartyGroup): PartyGroupDto {
  return { id: g.id, name: g.name, is_active: g.is_active };
}

export { PARTY_TYPE_LABEL };
