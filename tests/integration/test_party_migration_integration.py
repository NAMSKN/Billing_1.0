"""Existing-customer migration and invoice-integration tests (product rules 19, 20)."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date

from invoice_generator.domain.models import Address, Customer, Invoice, InvoiceLine
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.customer_repository import SqliteCustomerRepository
from invoice_generator.infrastructure.db.migrator import (
    apply_pending,
    discover_migrations,
)
from invoice_generator.infrastructure.db.schema import ensure_schema_version_table
from tests.support.build_test_app import build_test_app
from vendor_customer.application.dto import CreatePartyCommand, PartyInput
from vendor_customer.domain.models import PartyAddress, PartyType
from vendor_customer.infrastructure.db.sqlite_party_repository import SqlitePartyRepository


def _apply_up_to(conn: sqlite3.Connection, max_version: int) -> None:
    ensure_schema_version_table(conn)
    for migration in discover_migrations():
        if migration.version > max_version:
            continue
        with conn:
            conn.executescript(migration.sql)
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?)", (migration.version,)
            )


def test_existing_customer_migrated_into_parties() -> None:
    conn = connect(":memory:")
    # Simulate an older database that predates the parties feature.
    _apply_up_to(conn, 2)
    customer_id = uuid.uuid4()
    customers = SqliteCustomerRepository(conn)
    customers.save(
        Customer(
            id=customer_id,
            name="Legacy Customer",
            gstin="27ABCDE1234F1Z5",
            phone="9998887776",
            bill_to=Address(line="Old Rd", state_name="Maharashtra", state_code="27"),
        )
    )
    # Now upgrade: apply the parties migration.
    apply_pending(conn)

    parties = SqlitePartyRepository(conn)
    migrated = parties.get(customer_id)
    assert migrated is not None, "existing customer must migrate into parties"
    assert migrated.id == customer_id  # SAME UUID preserved
    assert migrated.company_name == "Legacy Customer"
    assert migrated.company_type is PartyType.CUSTOMER
    assert migrated.billing_address.state == "Maharashtra"


def test_existing_invoice_still_opens_after_migration(tmp_path) -> None:  # type: ignore[no-untyped-def]
    app = build_test_app(tmp_path)
    # Create a customer + draft invoice via the invoice module (pre-party path).
    customer = Customer(
        name="Invoice Cust",
        bill_to=Address(line="A", state_name="Maharashtra", state_code="27"),
    )
    app.customer_service_repo.save(customer)
    draft = Invoice(customer_id=customer.id)
    created = app.invoice_service.create_draft(draft)
    # Reopen it.
    reopened = app.invoice_service.get(created.id)
    assert reopened is not None
    assert reopened.customer_id == customer.id
    app.close()


def test_new_invoice_only_lists_customer_capable_parties(tmp_path) -> None:  # type: ignore[no-untyped-def]
    app = build_test_app(tmp_path)
    party_svc = app.party_service

    def _india(name: str, ptype: PartyType) -> PartyInput:
        return PartyInput(
            company_name=name,
            company_type=ptype,
            billing_address=PartyAddress(state="Maharashtra", state_code="27", city="Pune"),
        )

    party_svc.create_party(CreatePartyCommand(_india("CustOnly", PartyType.CUSTOMER)))
    party_svc.create_party(CreatePartyCommand(_india("Both Inc", PartyType.CUSTOMER_VENDOR)))
    party_svc.create_party(CreatePartyCommand(_india("VendOnly", PartyType.VENDOR)))

    selectable = {c.name for c in app.customer_service_repo.list_active()}
    assert "CustOnly" in selectable
    assert "Both Inc" in selectable
    assert "VendOnly" not in selectable  # vendor-only excluded from sales customers
    app.close()


def test_finalized_invoice_reproduces_after_party_edit(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """A finalized invoice snapshot is unaffected by later party/customer edits."""
    from decimal import Decimal

    from invoice_generator.domain.models import Company, PlaceOfSupply

    app = build_test_app(tmp_path)
    app.company_service_repo.save(
        Company(
            name="Suntech",
            address=Address(state_name="Maharashtra", state_code="27"),
            gstin="27ABCDE1234F1Z5",
        )
    )

    party = app.party_service.create_party(
        CreatePartyCommand(
            PartyInput(
                company_name="Snapshot Co",
                company_type=PartyType.CUSTOMER,
                billing_address=PartyAddress(
                    state="Maharashtra", state_code="27", city="Pune"
                ),
            )
        )
    )
    draft = app.invoice_service.create_draft(
        Invoice(
            customer_id=party.id,
            place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
            lines=(
                InvoiceLine(
                    description="Item",
                    hsn_sac="998898",
                    quantity=Decimal("1"),
                    rate=Decimal("100"),
                    tax_rate=Decimal("18"),
                ),
            ),
        )
    )
    finalized = app.invoice_service.finalize(draft.id, invoice_date=date(2026, 9, 11))
    assert finalized.snapshot is not None
    original_name = finalized.snapshot.customer.name

    # Edit the party name afterwards.
    from vendor_customer.application.dto import UpdatePartyCommand

    app.party_service.update_party(
        UpdatePartyCommand(
            id=party.id,
            data=PartyInput(
                company_name="Renamed Later",
                company_type=PartyType.CUSTOMER,
                billing_address=PartyAddress(
                    state="Maharashtra", state_code="27", city="Pune"
                ),
            ),
            is_active=True,
        )
    )
    reloaded = app.invoice_service.get(finalized.id)
    assert reloaded is not None and reloaded.snapshot is not None
    assert reloaded.snapshot.customer.name == original_name  # snapshot immutable
    app.close()
