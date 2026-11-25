import type { Customer, Address } from '@shared/domain/models';
import type { CustomerRepository } from '@shared/domain/repositories';
import { isCustomerType, type Party, type PartyAddress } from '@shared/domain/party';
import { stateNameFor } from '@shared/domain/indiaStates';

/**
 * Keeps the invoice-facing `customers` table in sync with customer-capable
 * parties (DECISIONS D-034). A customer or customer/vendor party is mirrored
 * 1:1 into `customers` with the SAME UUID, so invoice selection, finalization,
 * snapshot reproduction, and PDF generation keep working unchanged. Vendor-only
 * parties are never projected.
 */
export interface CustomerProjection {
  syncFromParty(party: Party): void;
  deactivate(partyId: string): void;
}

/** Compose the invoice module's single-line Address from a structured party address. */
function toInvoiceAddress(address: PartyAddress): Address {
  const parts = [
    address.address1.trim(),
    address.address2.trim(),
    address.landmark.trim(),
    address.city.trim(),
    address.pincode.trim(),
  ].filter(Boolean);
  return {
    line: parts.join(', '),
    state_name: address.state,
    state_code: address.state_code,
    godown: '',
  };
}

/**
 * The first two digits of a GSTIN are the GST state code. When a party's
 * address was saved without a state (older records / imports), we recover it
 * from the GSTIN so the invoice — and its Bill-to / Ship-to blocks and
 * intra/inter-state tax determination — always carry an authoritative state.
 * This never overwrites a state the user did enter.
 */
function withStateFromGstin(address: Address, gstin: string): Address {
  if (address.state_code.trim() && address.state_name.trim()) return address;
  const code = gstin.trim().slice(0, 2);
  const name = stateNameFor(code);
  if (!name) return address;
  return {
    ...address,
    state_code: address.state_code.trim() || code,
    state_name: address.state_name.trim() || name,
  };
}

export class InvoiceCustomerProjection implements CustomerProjection {
  constructor(private readonly customers: CustomerRepository) {}

  syncFromParty(party: Party): void {
    if (!isCustomerType(party.company_type)) return;
    const bill = withStateFromGstin(toInvoiceAddress(party.billing_address), party.gstin);
    const ship = withStateFromGstin(
      toInvoiceAddress(party.shipping_address ?? party.billing_address),
      party.gstin,
    );
    const customer: Customer = {
      id: party.id,
      name: party.company_name,
      gstin: party.gstin,
      phone: party.contact_no,
      email: party.email,
      bill_to: bill,
      ship_to: ship,
      is_active: party.is_active,
    };
    this.customers.save(customer);
  }

  deactivate(partyId: string): void {
    const existing = this.customers.get(partyId);
    if (existing !== null) {
      this.customers.save({ ...existing, is_active: false });
    }
  }
}
