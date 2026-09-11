"""Adapter that projects a customer-capable party into the invoice module.

Existing invoices reference customers via ``invoices.customer_id`` and embed a
:class:`~invoice_generator.domain.models.Customer` inside the immutable
finalized snapshot. To keep invoice selection, finalization, and snapshot
reproduction working unchanged (product rules, sections 19/20), a party that
can act as a sales customer is mirrored into the legacy ``customers`` table with
the SAME UUID whenever it is saved.

This adapter is the only place that maps the party's :class:`PartyAddress`
(``state`` / ``city``) onto the invoice module's ``Address``
(``state_name`` / ``line``). It performs no calculations.
"""

from __future__ import annotations

import uuid

from invoice_generator.domain.models import Address, Customer
from invoice_generator.domain.repositories import CustomerRepository
from vendor_customer.domain.models import Party, PartyAddress


class InvoiceCustomerProjection:
    """Implements :class:`~vendor_customer.application.ports.CustomerProjection`."""

    def __init__(self, customer_repository: CustomerRepository) -> None:
        self._customers = customer_repository

    def sync_from_party(self, party: Party) -> None:
        """Create/update the invoice-facing customer mirror for ``party``."""
        self._customers.save(self._to_customer(party))

    def deactivate(self, party_id: uuid.UUID) -> None:
        """Mark the projected customer inactive when the party is archived."""
        existing = self._customers.get(party_id)
        if existing is not None:
            self._customers.save(existing.model_copy(update={"is_active": False}))

    def _to_customer(self, party: Party) -> Customer:
        bill = _to_invoice_address(party.billing_address)
        ship_source = party.shipping_address or party.billing_address
        ship = _to_invoice_address(ship_source)
        return Customer(
            id=party.id,
            name=party.company_name,
            gstin=party.gstin,
            phone=party.contact_no,
            email=party.email,
            bill_to=bill,
            ship_to=ship,
            is_active=party.is_active,
        )


def _to_invoice_address(address: PartyAddress) -> Address:
    """Map a party address to the invoice module's Address value object.

    The single-line invoice address is composed from the party's structured
    address lines / landmark / city so existing PDF/snapshot rendering keeps a
    meaningful billing line.
    """
    parts = [
        p
        for p in (
            address.address1.strip(),
            address.address2.strip(),
            address.landmark.strip(),
            address.city.strip(),
            address.pincode.strip(),
        )
        if p
    ]
    return Address(
        line=", ".join(parts),
        state_name=address.state,
        state_code=address.state_code,
    )
