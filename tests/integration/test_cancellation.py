"""Integration tests for invoice cancellation."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.application.invoice_service import InvoiceService, InvoiceServiceError
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

INVOICE_DATE = date(2026, 5, 11)


class _Ctx:
    def __init__(self, tmp_path: Path) -> None:
        self.conn: sqlite3.Connection = connect(tmp_path / "test.db")
        apply_pending(self.conn)
        self.invoices = SqliteInvoiceRepository(self.conn)
        companies = SqliteCompanyRepository(self.conn)
        customers = SqliteCustomerRepository(self.conn)
        self.service = InvoiceService(
            self.conn,
            self.invoices,
            company_repository=companies,
            customer_repository=customers,
            numbering_service=NumberingService(SqliteSequenceRepository(self.conn)),
            settings_service=SettingsService(SqliteSettingsRepository(self.conn)),
        )
        company = Company(
            name="Suntech",
            address=Address(state_name="Maharashtra", state_code="27"),
        )
        self.customer = Customer(
            name="BMSS Steel",
            bill_to=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
        )
        companies.save(company)
        customers.save(self.customer)

    def finalize_one(self) -> Invoice:
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
        return self.service.finalize(draft.id, invoice_date=INVOICE_DATE)


@pytest.fixture
def ctx(tmp_path: Path) -> _Ctx:
    return _Ctx(tmp_path)


def test_cancel_keeps_uuid_and_number(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    cancelled = ctx.service.cancel(
        finalized.id, "wrong rate", when=datetime(2026, 5, 12, tzinfo=UTC)
    )
    assert cancelled.id == finalized.id  # same UUID (D-025)
    assert cancelled.invoice_number == finalized.invoice_number  # number not released
    assert cancelled.status is InvoiceStatus.CANCELLED


def test_cancel_records_timestamp_and_reason(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    when = datetime(2026, 5, 12, 9, 30, tzinfo=UTC)
    cancelled = ctx.service.cancel(finalized.id, "duplicate billing", when=when)
    assert cancelled.cancel_reason == "duplicate billing"
    assert cancelled.cancelled_at == when.isoformat()


def test_cancel_preserves_snapshot(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    cancelled = ctx.service.cancel(finalized.id, "reason")
    assert cancelled.snapshot is not None
    assert cancelled.snapshot.totals.grand_total == Decimal("14490.00")


def test_cancelled_invoice_not_hard_deleted(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    ctx.service.cancel(finalized.id, "reason")
    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None
    assert reloaded.status is InvoiceStatus.CANCELLED
    assert reloaded.invoice_number == finalized.invoice_number


def test_cancel_state_persisted_and_visible(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    when = datetime(2026, 5, 12, tzinfo=UTC)
    ctx.service.cancel(finalized.id, "audit correction", when=when)
    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None
    assert reloaded.cancel_reason == "audit correction"
    assert reloaded.cancelled_at == when.isoformat()


def test_cancel_with_replacement_link(ctx: _Ctx) -> None:
    original = ctx.finalize_one()
    replacement = ctx.finalize_one()  # a real invoice, satisfying the FK
    cancelled = ctx.service.cancel(
        original.id, "reissued", replacement_invoice_id=replacement.id
    )
    assert cancelled.replacement_invoice_id == replacement.id


def test_cancel_rejects_draft(ctx: _Ctx) -> None:
    draft = ctx.service.create_draft()
    with pytest.raises(InvoiceServiceError):
        ctx.service.cancel(draft.id, "reason")


def test_cancel_rejects_already_cancelled(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    ctx.service.cancel(finalized.id, "first")
    with pytest.raises(InvoiceServiceError):
        ctx.service.cancel(finalized.id, "again")


def test_cancel_rejects_missing_invoice(ctx: _Ctx) -> None:
    with pytest.raises(InvoiceServiceError):
        ctx.service.cancel(uuid.uuid4(), "reason")


def test_cancelled_number_still_unique_not_reusable(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    ctx.service.cancel(finalized.id, "reason")
    # A new finalization gets the NEXT number, not the cancelled one.
    draft2 = ctx.finalize_one()
    assert draft2.invoice_number == "SE/26-27/002"
    assert finalized.invoice_number == "SE/26-27/001"
