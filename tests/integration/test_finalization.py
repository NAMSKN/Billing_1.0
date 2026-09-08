"""Integration tests for atomic invoice finalization."""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.application.invoice_service import FinalizationError, InvoiceService
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.infrastructure.db.company_repository import SqliteCompanyRepository
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.customer_repository import SqliteCustomerRepository
from invoice_generator.infrastructure.db.invoice_repository import SqliteInvoiceRepository
from invoice_generator.infrastructure.db.migrator import apply_pending
from invoice_generator.infrastructure.db.sequence_repository import SqliteSequenceRepository
from invoice_generator.infrastructure.db.settings_repository import SqliteSettingsRepository
from tests.support.id_factory import SequentialIdGenerator

INVOICE_DATE = date(2026, 5, 11)


class _Ctx:
    def __init__(self, tmp_path: Path) -> None:
        self.conn: sqlite3.Connection = connect(tmp_path / "test.db")
        apply_pending(self.conn)
        self.invoices = SqliteInvoiceRepository(self.conn)
        self.companies = SqliteCompanyRepository(self.conn)
        self.customers = SqliteCustomerRepository(self.conn)
        self.settings = SettingsService(SqliteSettingsRepository(self.conn))
        self.numbering = NumberingService(SqliteSequenceRepository(self.conn))
        self.service = InvoiceService(
            self.conn,
            self.invoices,
            company_repository=self.companies,
            customer_repository=self.customers,
            numbering_service=self.numbering,
            settings_service=self.settings,
            id_generator=SequentialIdGenerator(start=1),
        )
        self.company = Company(
            name="Suntech",
            address=Address(state_name="Maharashtra", state_code="27"),
            gstin="27ABCDE1234F1Z5",
        )
        self.customer = Customer(
            name="BMSS Steel",
            bill_to=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
        )
        self.companies.save(self.company)
        self.customers.save(self.customer)

    def make_draft(self) -> Invoice:
        draft = self.service.create_draft(
            Invoice(
                customer_id=self.customer.id,
                place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
                lines=(
                    InvoiceLine(
                        description="Gundrilling",
                        hsn_sac="998898",
                        quantity=Decimal("16"),
                        unit="NOS",
                        rate=Decimal("767.50"),
                        tax_rate=Decimal("18"),
                    ),
                ),
            )
        )
        return draft


@pytest.fixture
def ctx(tmp_path: Path) -> _Ctx:
    return _Ctx(tmp_path)


def test_finalize_success_issues_number_and_locks(ctx: _Ctx) -> None:
    draft = ctx.make_draft()
    finalized = ctx.service.finalize(draft.id, invoice_date=INVOICE_DATE)
    assert finalized.status is InvoiceStatus.FINALIZED
    assert finalized.invoice_number == "SE/26-27/001"
    assert finalized.template_version == InvoiceService.DEFAULT_TEMPLATE_VERSION
    # Totals computed (intra-state golden math for taxable 12280).
    assert finalized.totals is not None
    assert finalized.totals.total_taxable == Decimal("12280.00")
    assert finalized.totals.total_cgst == Decimal("1105.20")
    assert finalized.totals.total_sgst == Decimal("1105.20")
    assert finalized.totals.round_off == Decimal("-0.40")
    assert finalized.totals.grand_total == Decimal("14490.00")
    # Snapshot present and authoritative.
    assert finalized.snapshot is not None
    assert finalized.snapshot.grand_total_words == "INR Fourteen Thousand Four Hundred Ninety Only"
    # Persisted.
    loaded = ctx.service.get(draft.id)
    assert loaded is not None and loaded.invoice_number == "SE/26-27/001"


def test_finalize_blocks_on_validation_failure(ctx: _Ctx) -> None:
    # Draft with no place of supply -> strict validation blocks.
    draft = ctx.service.create_draft(
        Invoice(
            customer_id=ctx.customer.id,
            lines=(
                InvoiceLine(
                    description="x", hsn_sac="998898", quantity=Decimal("1"), rate=Decimal("1")
                ),
            ),
        )
    )
    with pytest.raises(FinalizationError) as exc:
        ctx.service.finalize(draft.id, invoice_date=INVOICE_DATE)
    assert exc.value.result is not None
    assert any(i.field == "place_of_supply.state_code" for i in exc.value.result.blocking)
    # No number issued; invoice still a draft.
    loaded = ctx.service.get(draft.id)
    assert loaded is not None and loaded.status is InvoiceStatus.DRAFT
    assert loaded.invoice_number is None


def test_sequential_finalizations_get_distinct_numbers(ctx: _Ctx) -> None:
    d1 = ctx.make_draft()
    d2 = ctx.make_draft()
    f1 = ctx.service.finalize(d1.id, invoice_date=INVOICE_DATE)
    f2 = ctx.service.finalize(d2.id, invoice_date=INVOICE_DATE)
    assert f1.invoice_number == "SE/26-27/001"
    assert f2.invoice_number == "SE/26-27/002"


def test_finalize_rejects_non_draft(ctx: _Ctx) -> None:
    draft = ctx.make_draft()
    ctx.service.finalize(draft.id, invoice_date=INVOICE_DATE)
    with pytest.raises(FinalizationError):
        ctx.service.finalize(draft.id, invoice_date=INVOICE_DATE)  # already finalized


def test_rolled_back_number_is_reusable(ctx: _Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    # Force a failure after number allocation to prove rollback + reuse (D-027).
    draft = ctx.make_draft()
    original_save = ctx.invoices.save
    calls = {"n": 0}

    def failing_save(invoice: Invoice) -> None:
        # Let the numbering allocation persist within the tx, then fail the
        # invoice persist so the whole transaction rolls back.
        calls["n"] += 1
        raise sqlite3.OperationalError("simulated persist failure")

    monkeypatch.setattr(ctx.invoices, "save", failing_save)
    with pytest.raises(sqlite3.OperationalError):
        ctx.service.finalize(draft.id, invoice_date=INVOICE_DATE)

    # Restore save; the previously allocated number was rolled back (not issued).
    monkeypatch.setattr(ctx.invoices, "save", original_save)
    draft2 = ctx.make_draft()
    finalized = ctx.service.finalize(draft2.id, invoice_date=INVOICE_DATE)
    assert finalized.invoice_number == "SE/26-27/001"  # sequence not consumed


def test_finalize_requires_services(tmp_path: Path) -> None:
    conn = connect(tmp_path / "t.db")
    apply_pending(conn)
    service = InvoiceService(conn, SqliteInvoiceRepository(conn))  # no services
    draft = service.create_draft()
    with pytest.raises(FinalizationError):
        service.finalize(draft.id, invoice_date=INVOICE_DATE)
