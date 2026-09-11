"""Repository ports for the Customer / Vendor (Party) master.

Typed :class:`~typing.Protocol` contracts. Application services depend on these
ports, not on concrete SQLite classes (DECISIONS D-021). Ports accept and return
domain models; conversion to/from storage happens inside the implementations.
Repositories participate in the caller's transaction and never begin/commit
their own (DECISIONS D-026).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from vendor_customer.domain.models import Party, PartyGroup, PartyType


@runtime_checkable
class PartyRepository(Protocol):
    """Persistence for unified customer / vendor parties."""

    def get(self, party_id: uuid.UUID) -> Party | None:
        """Fetch a party by id (active or archived), or ``None``."""
        ...

    def get_by_gstin(self, gstin: str) -> Party | None:
        """Fetch a party by exact GSTIN (any status), or ``None``."""
        ...

    def find_by_name_and_phone(self, company_name: str, contact_no: str) -> Party | None:
        """Fetch a party by normalized name + phone for duplicate matching."""
        ...

    def list_all(
        self,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        """List parties, optionally filtered by role/type and archived status.

        A ``party_type`` filter matches inclusively: filtering by ``CUSTOMER``
        also returns ``CUSTOMER_VENDOR`` parties, and likewise for ``VENDOR``.
        """
        ...

    def save(self, party: Party) -> None:
        """Insert or update a party record."""
        ...

    def archive(self, party_id: uuid.UUID) -> bool:
        """Soft-delete: mark a party inactive. Returns ``True`` if one changed."""
        ...


@runtime_checkable
class PartyGroupRepository(Protocol):
    """Persistence for selectable customer / vendor groups."""

    def get(self, group_id: uuid.UUID) -> PartyGroup | None:
        ...

    def get_by_name(self, name: str) -> PartyGroup | None:
        ...

    def list_all(self, *, include_archived: bool = False) -> Sequence[PartyGroup]:
        ...

    def save(self, group: PartyGroup) -> None:
        ...

    def archive(self, group_id: uuid.UUID) -> bool:
        ...

    def count_parties_in_group(self, group_id: uuid.UUID) -> int:
        """Number of parties referencing this group (for safe archival)."""
        ...
