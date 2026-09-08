"""Integration tests for invoice duplication."""

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

    def draft(self) -> Invoice:
        return self.service.create_draft(
            Invoice(
                customer_id=self.customer.id,
                place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
                notes="repeat job",
                terms="Net 30",
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

    def finalized(self) -> Invoice:
        return self.service.finalize(self.draft().id, invoice_date=INVOICE_DATE)


@pytest.fixture
def ctx(tmp_path: Path) -> _Ctx:
    return _Ctx(tmp_path)


def test_duplicate_of_finalized_is_new_draft(ctx: _Ctx) -> None:
    original = ctx.finalized()
    dup = ctx.service.duplicate(original.id)
    assert dup.status is InvoiceStatus.DRAFT
    assert dup.invoice_number is None
    assert dup.id != original.id  # new UUID (D-025)
    assert dup.payment_status is PaymentStatus.UNPAID


def test_duplicate_excludes_finalized_artifacts(ctx: _Ctx) -> None:
    original = ctx.finalized()
    dup = ctx.service.duplicate(original.id)
    assert dup.totals is None
    assert dup.snapshot is None
    assert dup.template_version is None
    assert dup.cancelled_at == ""
    assert dup.replacement_invoice_id is None


def test_duplicate_copies_editable_content(ctx: _Ctx) -> None:
    original = ctx.finalized()
    dup = ctx.service.duplicate(original.id)
    assert dup.customer_id == original.customer_id
    assert dup.place_of_supply == original.place_of_supply
    assert dup.notes == "repeat job"
    assert dup.terms == "Net 30"
    assert len(dup.lines) == 1
    assert dup.lines[0].description == "Gundrilling"
    assert dup.lines[0].rate == Decimal("767.50")


def test_duplicate_lines_get_new_ids_and_cleared_amounts(ctx: _Ctx) -> None:
    original = ctx.finalized()
    dup = ctx.service.duplicate(original.id)
    assert dup.lines[0].id != original.lines[0].id  # fresh line UUID
    assert dup.lines[0].taxable_amount is None  # cleared; recomputed at finalize
    assert dup.lines[0].cgst_amount is None


def test_original_unchanged_after_duplicate(ctx: _Ctx) -> None:
    original = ctx.finalized()
    ctx.service.duplicate(original.id)
    reloaded = ctx.service.get(original.id)
    assert reloaded is not None
    assert reloaded.status is InvoiceStatus.FINALIZED
    assert reloaded.invoice_number == original.invoice_number


def test_duplicate_is_persisted(ctx: _Ctx) -> None:
    original = ctx.finalized()
    dup = ctx.service.duplicate(original.id)
    loaded = ctx.service.get(dup.id)
    assert loaded is not None
    assert loaded.status is InvoiceStatus.DRAFT


def test_duplicate_can_be_finalized_with_new_number(ctx: _Ctx) -> None:
    original = ctx.finalized()  # SE/26-27/001
    dup = ctx.service.duplicate(original.id)
    finalized_dup = ctx.service.finalize(dup.id, invoice_date=INVOICE_DATE)
    assert finalized_dup.invoice_number == "SE/26-27/002"  # its own new number
    assert original.invoice_number == "SE/26-27/001"


def test_duplicate_of_draft(ctx: _Ctx) -> None:
    draft = ctx.draft()
    dup = ctx.service.duplicate(draft.id)
    assert dup.status is InvoiceStatus.DRAFT
    assert dup.id != draft.id
    assert dup.notes == "repeat job"


def test_duplicate_missing_invoice_raises(ctx: _Ctx) -> None:
    with pytest.raises(InvoiceServiceError):
        ctx.service.duplicate(uuid.uuid4())
