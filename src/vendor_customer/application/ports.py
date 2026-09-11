"""Outbound ports the party services depend on (dependency inversion).

These protocols let the party application layer stay independent of the invoice
module. The concrete implementations live in the composition/integration layer.
"""

from __future__ import annotations

import uuid
from typing import Protocol, runtime_checkable

from vendor_customer.domain.models import Party


@runtime_checkable
class CustomerProjection(Protocol):
    """Keeps the invoice-facing customer projection in sync with a party.

    A party that can act as a sales customer is mirrored into the legacy
    ``customers`` table (same UUID) so existing invoice selection, finalization,
    and snapshot reproduction keep working unchanged (product rules, section 20).
    Vendor-only parties are not projected as selectable customers.
    """

    def sync_from_party(self, party: Party) -> None:
        """Create/update the customer projection for ``party``."""
        ...

    def deactivate(self, party_id: uuid.UUID) -> None:
        """Mark the projected customer inactive (archived party)."""
        ...
