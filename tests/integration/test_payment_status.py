"""Integration tests for payment status (independent of invoice lifecycle)."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.application.invoice_service import InvoiceService, InvoiceServiceError
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
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
        companies.save(
            Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
        )
        self.customer = Customer(
            name="BMSS Steel",
            bill_to=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
        )
        customers.save(self.customer)

    def finalized(self) -> Invoice:
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


def test_finalized_defaults_to_unpaid(ctx: _Ctx) -> None:
    finalized = ctx.finalized()
    assert finalized.status is InvoiceStatus.FINALIZED
    assert finalized.payment_status is PaymentStatus.UNPAID  # FINALIZED + UNPAID valid


@pytest.mark.parametrize(
    "status", [PaymentStatus.PARTIAL, PaymentStatus.PAID, PaymentStatus.UNPAID]
)
def test_set_payment_status(ctx: _Ctx, status: PaymentStatus) -> None:
    finalized = ctx.finalized()
    updated = ctx.service.set_payment_status(finalized.id, status)
    assert updated.payment_status is status
    assert updated.status is InvoiceStatus.FINALIZED  # lifecycle unchanged


def test_payment_status_change_does_not_alter_financials_or_number(ctx: _Ctx) -> None:
    finalized = ctx.finalized()
    before_totals = finalized.totals
    before_number = finalized.invoice_number
    updated = ctx.service.set_payment_status(finalized.id, PaymentStatus.PAID)
    assert updated.totals == before_totals
    assert updated.invoice_number == before_number
    assert updated.snapshot == finalized.snapshot


def test_payment_status_persisted(ctx: _Ctx) -> None:
    finalized = ctx.finalized()
    ctx.service.set_payment_status(finalized.id, PaymentStatus.PARTIAL)
    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None
    assert reloaded.payment_status is PaymentStatus.PARTIAL
    assert reloaded.totals is not None
    assert reloaded.totals.grand_total == Decimal("14490.00")


def test_payment_status_independent_of_cancelled_lifecycle(ctx: _Ctx) -> None:
    finalized = ctx.finalized()
    ctx.service.cancel(finalized.id, "reason")
    updated = ctx.service.set_payment_status(finalized.id, PaymentStatus.PAID)
    # Payment status is independent of lifecycle status.
    assert updated.status is InvoiceStatus.CANCELLED
    assert updated.payment_status is PaymentStatus.PAID


def test_set_payment_status_missing_invoice_raises(ctx: _Ctx) -> None:
    with pytest.raises(InvoiceServiceError):
        ctx.service.set_payment_status(uuid.uuid4(), PaymentStatus.PAID)
