import { formatMoney } from '@shared/domain/money';
import {
  PAYMENT_MODE_LABEL,
  VOUCHER_PARTY_LABEL,
  VOUCHER_TITLE,
  type Payment,
  type PaymentSnapshot,
} from '@shared/domain/payment';
import type { Address, Company } from '@shared/domain/models';

/**
 * Immutable render DTO for a finalized Receipt/Payment voucher, built from the
 * stored SNAPSHOT only (D-011). The renderer consumes this and nothing else —
 * no DB, no recalculation. All numeric values arrive as preformatted strings.
 */

export interface RenderVoucherParty {
  name: string;
  address_lines: string[];
  gstin: string;
  state: string;
}

export interface RenderVoucherAllocation {
  invoice_number: string;
  amount: string;
}

export interface PaymentRenderDTO {
  title: string;
  party_label: string;
  voucher_number: string;
  voucher_date: string;
  company: RenderVoucherParty;
  party: RenderVoucherParty;
  amount: string;
  amount_words: string;
  mode_label: string;
  reference_no: string;
  remarks: string;
  allocations: RenderVoucherAllocation[];
  cancelled: boolean;
}

function companyParty(company: Company): RenderVoucherParty {
  return addressParty(company.name, company.address, company.gstin);
}

function addressParty(name: string, address: Address, gstin: string): RenderVoucherParty {
  const lines = address.line ? address.line.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const state = address.state_name
    ? `${address.state_name}${address.state_code ? ` (${address.state_code})` : ''}`
    : '';
  return { name, address_lines: lines, gstin, state };
}

export function buildPaymentRenderDto(payment: Payment): PaymentRenderDTO {
  const snap: PaymentSnapshot | null = payment.snapshot;
  if (snap === null) {
    throw new Error('voucher has no snapshot; only finalized vouchers are renderable');
  }
  return {
    title: VOUCHER_TITLE[snap.direction],
    party_label: VOUCHER_PARTY_LABEL[snap.direction],
    voucher_number: payment.payment_number ?? '',
    voucher_date: snap.payment_date,
    company: companyParty(snap.company),
    party: addressParty(snap.party.name, snap.party.address, snap.party.gstin),
    amount: formatMoney(snap.amount),
    amount_words: snap.amount_words,
    mode_label: PAYMENT_MODE_LABEL[snap.mode],
    reference_no: snap.reference_no,
    remarks: snap.remarks,
    allocations: snap.allocations.map((a) => ({
      invoice_number: a.invoice_number,
      amount: formatMoney(a.amount),
    })),
    cancelled: payment.status === 'CANCELLED',
  };
}
