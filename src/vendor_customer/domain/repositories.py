"""Repository protocols for Vendor & Customer persistence."""

from __future__ import annotations

import uuid
from typing import Optional, Protocol, Sequence, runtime_checkable

from vendor_customer.domain.models import Party, PartyRole


@runtime_checkable
class PartyRepository(Protocol):
    """Abstract repository for storing and querying trading parties."""

    def get_by_id(self, party_id: uuid.UUID) -> Optional[Party]:
        """Fetch party by UUID."""
        ...

    def get_by_gstin(self, gstin: str) -> Optional[Party]:
        """Fetch active party by GSTIN."""
        ...

    def list_all(
        self, role: Optional[PartyRole] = None, include_inactive: bool = False
    ) -> Sequence[Party]:
        """List parties optionally filtered by role and active status."""
        ...

    def save(self, party: Party) -> None:
        """Insert or update party record."""
        ...

    def archive(self, party_id: uuid.UUID) -> bool:
        """Mark party as inactive (soft-delete)."""
        ...
