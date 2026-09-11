"""Infrastructure adapters for Vendor & Customer Management."""

from vendor_customer.infrastructure.db.sqlite_party_repository import (
    SqlitePartyRepository,
)

__all__ = ["SqlitePartyRepository"]
