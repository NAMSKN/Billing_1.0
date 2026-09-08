"""In-memory fake repositories for unit tests (test infrastructure only).

These satisfy the domain repository ports and let services be tested without
SQLite. They store domain models directly in dicts. Not used by application
code.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from invoice_generator.domain.models import (
    Asset,
    Company,
    Customer,
    Invoice,
    SequenceState,
)


class InMemoryCompanyRepository:
    def __init__(self) -> None:
        self._by_id: dict[uuid.UUID, Company] = {}

    def get(self, company_id: uuid.UUID) -> Company | None:
        return self._by_id.get(company_id)

    def get_active(self) -> Company | None:
        for company in self._by_id.values():
            if company.active:
                return company
        return None

    def save(self, company: Company) -> None:
        self._by_id[company.id] = company


class InMemoryCustomerRepository:
    def __init__(self) -> None:
        self._by_id: dict[uuid.UUID, Customer] = {}

    def get(self, customer_id: uuid.UUID) -> Customer | None:
        return self._by_id.get(customer_id)

    def save(self, customer: Customer) -> None:
        self._by_id[customer.id] = customer

    def list_active(self) -> Sequence[Customer]:
        return [c for c in self._by_id.values() if c.is_active]


class InMemoryInvoiceRepository:
    def __init__(self) -> None:
        self._by_id: dict[uuid.UUID, Invoice] = {}

    def get(self, invoice_id: uuid.UUID) -> Invoice | None:
        return self._by_id.get(invoice_id)

    def save(self, invoice: Invoice) -> None:
        self._by_id[invoice.id] = invoice

    def delete_draft(self, invoice_id: uuid.UUID) -> None:
        self._by_id.pop(invoice_id, None)

    def list_summaries(self) -> Sequence[Invoice]:
        return list(self._by_id.values())


class InMemorySequenceRepository:
    def __init__(self) -> None:
        self._by_key: dict[tuple[uuid.UUID, str, str], SequenceState] = {}

    def get(
        self,
        company_id: uuid.UUID,
        financial_year: str,
        prefix: str,
    ) -> SequenceState | None:
        return self._by_key.get((company_id, financial_year, prefix))

    def save(self, state: SequenceState) -> None:
        self._by_key[(state.company_id, state.financial_year, state.prefix)] = state


class InMemoryAssetRepository:
    def __init__(self) -> None:
        self._by_id: dict[uuid.UUID, Asset] = {}

    def get(self, asset_id: uuid.UUID) -> Asset | None:
        return self._by_id.get(asset_id)

    def save(self, asset: Asset) -> None:
        self._by_id[asset.id] = asset


class InMemorySettingsRepository:
    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._values.get(key)

    def set(self, key: str, value: str) -> None:
        self._values[key] = value
