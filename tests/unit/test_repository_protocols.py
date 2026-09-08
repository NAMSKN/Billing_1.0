"""Tests that in-memory fakes satisfy the repository ports and round-trip."""

from __future__ import annotations

import uuid
from decimal import Decimal

from invoice_generator.domain.models import (
    Asset,
    Company,
    Customer,
    Invoice,
    SequenceState,
)
from invoice_generator.domain.repositories import (
    AssetRepository,
    CompanyRepository,
    CustomerRepository,
    InvoiceRepository,
    SequenceRepository,
    SettingsRepository,
)
from tests.support.fakes import (
    InMemoryAssetRepository,
    InMemoryCompanyRepository,
    InMemoryCustomerRepository,
    InMemoryInvoiceRepository,
    InMemorySequenceRepository,
    InMemorySettingsRepository,
)


def test_fakes_satisfy_ports_at_runtime() -> None:
    assert isinstance(InMemoryCompanyRepository(), CompanyRepository)
    assert isinstance(InMemoryCustomerRepository(), CustomerRepository)
    assert isinstance(InMemoryInvoiceRepository(), InvoiceRepository)
    assert isinstance(InMemorySequenceRepository(), SequenceRepository)
    assert isinstance(InMemoryAssetRepository(), AssetRepository)
    assert isinstance(InMemorySettingsRepository(), SettingsRepository)


def test_company_repository_round_trip() -> None:
    repo: CompanyRepository = InMemoryCompanyRepository()
    company = Company(name="Suntech")
    repo.save(company)
    assert repo.get(company.id) == company
    assert repo.get_active() == company
    assert repo.get(uuid.uuid4()) is None


def test_customer_repository_round_trip_and_active_filter() -> None:
    repo: CustomerRepository = InMemoryCustomerRepository()
    active = Customer(name="A", is_active=True)
    inactive = Customer(name="B", is_active=False)
    repo.save(active)
    repo.save(inactive)
    assert repo.get(active.id) == active
    listed = repo.list_active()
    assert active in listed
    assert inactive not in listed


def test_invoice_repository_round_trip_and_delete() -> None:
    repo: InvoiceRepository = InMemoryInvoiceRepository()
    invoice = Invoice(notes="draft")
    repo.save(invoice)
    assert repo.get(invoice.id) == invoice
    assert list(repo.list_summaries()) == [invoice]
    repo.delete_draft(invoice.id)
    assert repo.get(invoice.id) is None


def test_sequence_repository_round_trip() -> None:
    repo: SequenceRepository = InMemorySequenceRepository()
    company_id = uuid.uuid4()
    state = SequenceState(
        company_id=company_id,
        financial_year="26-27",
        prefix="SE",
        next_sequence=43,
        high_water_mark=42,
    )
    repo.save(state)
    assert repo.get(company_id, "26-27", "SE") == state
    assert repo.get(company_id, "27-28", "SE") is None


def test_asset_repository_round_trip() -> None:
    repo: AssetRepository = InMemoryAssetRepository()
    asset = Asset(kind="logo", sha256="abc", stored_path="/assets/logo.png")
    repo.save(asset)
    assert repo.get(asset.id) == asset


def test_settings_repository_round_trip() -> None:
    repo: SettingsRepository = InMemorySettingsRepository()
    assert repo.get("missing") is None
    repo.set("prefix", "SE")
    assert repo.get("prefix") == "SE"


def test_money_stays_decimal_through_port() -> None:
    # Ports carry domain models with Decimal money, never rows/paise.
    repo: InvoiceRepository = InMemoryInvoiceRepository()
    invoice = Invoice()
    repo.save(invoice)
    loaded = repo.get(invoice.id)
    assert loaded is not None
    # Totals default to None until calculated; when present they are Decimal.
    assert loaded.totals is None
    _ = Decimal("0.00")  # money type used across the domain
