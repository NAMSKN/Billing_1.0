"""Repository ports (interfaces).

Typed :class:`~typing.Protocol` contracts for persistence. Application services
depend on these ports, not on concrete SQLite classes (DECISIONS D-021), which
keeps business logic testable with in-memory fakes and free of SQL.

Ports accept and return domain models (``Decimal`` money, UUID ids), never
database rows. Conversion to/from exact scaled integers happens inside the
SQLite implementations (Task 17), not here.

Transaction ownership: repositories participate in a transaction owned by the
calling use case; they MUST NOT begin or commit their own transaction when
invoked within a use-case transaction (DECISIONS D-026). The port method
signatures below are deliberately simple; the concrete implementations receive
the active connection through construction/wiring.

References: requirements Req 23; DECISIONS D-021, D-026; design section 8.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from invoice_generator.domain.models import (
    Asset,
    Company,
    Customer,
    Invoice,
    SequenceState,
)


@runtime_checkable
class CompanyRepository(Protocol):
    """Persistence for the company master (single active company in V1)."""

    def get(self, company_id: uuid.UUID) -> Company | None: ...

    def get_active(self) -> Company | None: ...

    def save(self, company: Company) -> None: ...


@runtime_checkable
class CustomerRepository(Protocol):
    """Persistence for customers."""

    def get(self, customer_id: uuid.UUID) -> Customer | None: ...

    def save(self, customer: Customer) -> None: ...

    def list_active(self) -> Sequence[Customer]: ...


@runtime_checkable
class InvoiceRepository(Protocol):
    """Persistence for invoices and their line items."""

    def get(self, invoice_id: uuid.UUID) -> Invoice | None: ...

    def save(self, invoice: Invoice) -> None: ...

    def delete_draft(self, invoice_id: uuid.UUID) -> None: ...

    def list_summaries(self) -> Sequence[Invoice]: ...


@runtime_checkable
class SequenceRepository(Protocol):
    """Persistence for invoice-numbering sequence state (per scope)."""

    def get(
        self,
        company_id: uuid.UUID,
        financial_year: str,
        prefix: str,
    ) -> SequenceState | None: ...

    def save(self, state: SequenceState) -> None: ...


@runtime_checkable
class AssetRepository(Protocol):
    """Persistence for versioned invoice assets (logo/signature/stamp)."""

    def get(self, asset_id: uuid.UUID) -> Asset | None: ...

    def save(self, asset: Asset) -> None: ...


@runtime_checkable
class SettingsRepository(Protocol):
    """Persistence for simple key/value application settings."""

    def get(self, key: str) -> str | None: ...

    def set(self, key: str, value: str) -> None: ...
