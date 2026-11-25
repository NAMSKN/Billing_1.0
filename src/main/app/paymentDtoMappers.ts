import type { Address } from '@shared/domain/models';
import { Money } from '@shared/domain/money';
import type { Payment, PaymentAllocation, VoucherParty } from '@shared/domain/payment';
import type { AddressDto } from '@shared/challanDto';
import type {
  PaymentAllocationDto,
  PaymentDto,
  VoucherPartyDto,
} from '@shared/paymentDto';

/**
 * Domain <-> wire DTO conversions for Receipt/Payment vouchers. Money crosses
 * IPC as a decimal string; parse/format happens here at the main-process
 * boundary. The snapshot is never sent over the wire.
 */

const str = (v: { toFixed(n: number): string }): string => v.toFixed(2);

function addressToDto(a: Address): AddressDto {
  return { line: a.line, state_name: a.state_name, state_code: a.state_code, godown: a.godown };
}

function partyToDto(p: VoucherParty): VoucherPartyDto {
  return {
    party_id: p.party_id,
    name: p.name,
    gstin: p.gstin,
    pan: p.pan,
    phone: p.phone,
    address: addressToDto(p.address),
  };
}

function allocationToDto(a: PaymentAllocation): PaymentAllocationDto {
  return {
    id: a.id,
    payment_id: a.payment_id,
    invoice_id: a.invoice_id,
    invoice_number: a.invoice_number,
    amount: str(a.amount),
    status: a.status,
  };
}

export function paymentToDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    payment_number: p.payment_number,
    status: p.status,
    direction: p.direction,
    company_id: p.company_id,
    party_id: p.party_id,
    party: partyToDto(p.party),
    payment_date: p.payment_date,
    amount: str(p.amount),
    mode: p.mode,
    reference_no: p.reference_no,
    remarks: p.remarks,
    allocations: p.allocations.map(allocationToDto),
    cancelled_at: p.cancelled_at,
    cancel_reason: p.cancel_reason,
  };
}

/** Parse a decimal-string amount from a DTO into an exact Money value. */
export function parseAmount(s: string): InstanceType<typeof Money> {
  return new Money(s || '0');
}
