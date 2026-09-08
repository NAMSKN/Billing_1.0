"""Integration tests: finalized invoice snapshot is immutable and authoritative.

A finalized invoice must reproduce from its stored snapshot, independent of
later master-data edits (Req 12, DECISIONS D-010). Reproduction reads only the
invoice row + its line items (never a live join to companies/customers).
"""

from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.application.invoice_service import InvoiceService
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.settings_service import SettingsService
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
        self.companies = SqliteCompanyRepository(self.conn)
        self.customers = SqliteCustomerRepository(self.conn)
        self.service = InvoiceService(
            self.conn,
            self.invoices,
            company_repository=self.companies,
            customer_repository=self.customers,
            numbering_service=NumberingService(SqliteSequenceRepository(self.conn)),
            settings_service=SettingsService(SqliteSettingsRepository(self.conn)),
        )
        self.company = Company(
            name="Suntech Enterprises",
            address=Address(line="Old HQ", state_name="Maharashtra", state_code="27"),
            gstin="27ABCDE1234F1Z5",
        )
        self.customer = Customer(
            name="BMSS Steel",
            bill_to=Address(line="Old Customer Rd", state_name="Maharashtra", state_code="27"),
        )
        self.companies.save(self.company)
        self.customers.save(self.customer)

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


def test_editing_customer_master_does_not_change_snapshot(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    assert finalized.snapshot is not None
    assert finalized.snapshot.customer.name == "BMSS Steel"
    assert finalized.snapshot.bill_to.line == "Old Customer Rd"

    # Edit the customer master AFTER finalization.
    ctx.customers.save(
        ctx.customer.model_copy(
            update={
                "name": "BMSS Steel (Renamed)",
                "bill_to": Address(line="New Address", state_name="Gujarat", state_code="24"),
            }
        )
    )

    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None and reloaded.snapshot is not None
    # Snapshot preserves the original customer-facing values.
    assert reloaded.snapshot.customer.name == "BMSS Steel"
    assert reloaded.snapshot.bill_to.line == "Old Customer Rd"
    assert reloaded.snapshot.bill_to.state_code == "27"


def test_editing_company_master_does_not_change_snapshot(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    assert finalized.snapshot is not None
    assert finalized.snapshot.company.name == "Suntech Enterprises"
    assert finalized.snapshot.company.address.line == "Old HQ"

    ctx.companies.save(
        ctx.company.model_copy(
            update={
                "name": "Suntech Renamed",
                "address": Address(line="New HQ", state_name="Maharashtra", state_code="27"),
            }
        )
    )

    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None and reloaded.snapshot is not None
    assert reloaded.snapshot.company.name == "Suntech Enterprises"
    assert reloaded.snapshot.company.address.line == "Old HQ"


def test_snapshot_totals_and_words_preserved(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None and reloaded.snapshot is not None
    snap = reloaded.snapshot
    assert snap.totals.grand_total == Decimal("14490.00")
    assert snap.totals.round_off == Decimal("-0.40")
    assert snap.grand_total_words == "INR Fourteen Thousand Four Hundred Ninety Only"
    assert len(snap.lines) == 1
    assert snap.lines[0].taxable_amount == Decimal("12280.00")


def test_reproduction_reads_only_invoice_tables_not_masters(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    # Overwrite the master rows with garbage. If reproduction joined to live
    # master tables it would surface this garbage; instead it must return the
    # original snapshot values (proving no live-master join).
    ctx.conn.execute("UPDATE customers SET name = 'GARBAGE', bill_line = 'GARBAGE'")
    ctx.conn.execute("UPDATE companies SET name = 'GARBAGE', address_line = 'GARBAGE'")

    reloaded = ctx.service.get(finalized.id)
    assert reloaded is not None and reloaded.snapshot is not None
    assert reloaded.snapshot.customer.name == "BMSS Steel"
    assert reloaded.snapshot.bill_to.line == "Old Customer Rd"
    assert reloaded.snapshot.company.name == "Suntech Enterprises"
    assert reloaded.snapshot.company.address.line == "Old HQ"


def test_summary_listing_uses_structured_columns_without_snapshot_detail(ctx: _Ctx) -> None:
    finalized = ctx.finalize_one()
    summaries = ctx.invoices.list_summaries()
    assert len(summaries) == 1
    summary = summaries[0]
    # Structured columns available for listing (number, status, totals),
    # without loading line items.
    assert summary.invoice_number == finalized.invoice_number
    assert summary.lines == ()
    assert summary.totals is not None
    assert summary.totals.grand_total == Decimal("14490.00")
