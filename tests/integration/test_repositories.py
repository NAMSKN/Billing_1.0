"""Integration tests for the SQLite repository implementations."""

from __future__ import annotations

import sqlite3
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
from invoice_generator.domain.models import (
    Address,
    Asset,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    InvoiceReferences,
    InvoiceTotals,
    PlaceOfSupply,
    SequenceState,
)
from invoice_generator.infrastructure.db.asset_repository import SqliteAssetRepository
from invoice_generator.infrastructure.db.company_repository import SqliteCompanyRepository
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.customer_repository import SqliteCustomerRepository
from invoice_generator.infrastructure.db.invoice_repository import SqliteInvoiceRepository
from invoice_generator.infrastructure.db.migrator import apply_pending
from invoice_generator.infrastructure.db.sequence_repository import SqliteSequenceRepository
from invoice_generator.infrastructure.db.settings_repository import SqliteSettingsRepository


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = connect(tmp_path / "test.db")
    apply_pending(c)
    return c


def test_company_round_trip(conn: sqlite3.Connection) -> None:
    repo = SqliteCompanyRepository(conn)
    company = Company(
        name="Suntech Enterprises",
        address=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
        gstin="27ABCDE1234F1Z5",
    )
    repo.save(company)
    conn.commit()
    loaded = repo.get(company.id)
    assert loaded == company
    assert repo.get_active() == company


def test_customer_round_trip_preserves_distinct_addresses(conn: sqlite3.Connection) -> None:
    repo = SqliteCustomerRepository(conn)
    customer = Customer(
        name="BMSS Steel",
        bill_to=Address(line="Bill Rd", state_name="Maharashtra", state_code="27"),
        ship_to=Address(line="Ship Rd", state_name="Gujarat", state_code="24", godown="G1"),
    )
    repo.save(customer)
    conn.commit()
    loaded = repo.get(customer.id)
    assert loaded == customer
    assert loaded is not None
    assert loaded.bill_to.line == "Bill Rd"
    assert loaded.ship_to.line == "Ship Rd"


def test_customer_uuid_canonical_round_trip(conn: sqlite3.Connection) -> None:
    repo = SqliteCustomerRepository(conn)
    customer = Customer(name="X")
    repo.save(customer)
    conn.commit()
    stored = conn.execute("SELECT id FROM customers").fetchone()["id"]
    assert stored == str(customer.id)  # canonical lowercase text
    assert repo.get(customer.id) is not None


def test_customer_upsert_updates_same_id(conn: sqlite3.Connection) -> None:
    repo = SqliteCustomerRepository(conn)
    customer = Customer(name="Original")
    repo.save(customer)
    repo.save(customer.model_copy(update={"name": "Renamed"}))
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM customers").fetchone()["c"]
    assert count == 1  # same UUID -> one row, not duplicated
    loaded = repo.get(customer.id)
    assert loaded is not None and loaded.name == "Renamed"


def test_active_filter(conn: sqlite3.Connection) -> None:
    repo = SqliteCustomerRepository(conn)
    repo.save(Customer(name="Active", is_active=True))
    repo.save(Customer(name="Inactive", is_active=False))
    conn.commit()
    names = {c.name for c in repo.list_active()}
    assert names == {"Active"}


def test_asset_round_trip(conn: sqlite3.Connection) -> None:
    repo = SqliteAssetRepository(conn)
    asset = Asset(kind="logo", version=2, sha256="deadbeef", stored_path="/a/logo.png")
    repo.save(asset)
    conn.commit()
    assert repo.get(asset.id) == asset


def test_sequence_round_trip(conn: sqlite3.Connection) -> None:
    company = Company(name="C")
    SqliteCompanyRepository(conn).save(company)
    repo = SqliteSequenceRepository(conn)
    state = SequenceState(
        company_id=company.id,
        financial_year="26-27",
        prefix="SE",
        next_sequence=43,
        high_water_mark=42,
    )
    repo.save(state)
    conn.commit()
    assert repo.get(company.id, "26-27", "SE") == state


def test_settings_round_trip(conn: sqlite3.Connection) -> None:
    repo = SqliteSettingsRepository(conn)
    assert repo.get("missing") is None
    repo.set("prefix", "SE")
    conn.commit()
    assert repo.get("prefix") == "SE"


def test_invoice_round_trip_with_lines_and_exact_paise(conn: sqlite3.Connection) -> None:
    company = Company(name="C")
    customer = Customer(name="Cust")
    SqliteCompanyRepository(conn).save(company)
    SqliteCustomerRepository(conn).save(customer)
    repo = SqliteInvoiceRepository(conn)

    line = InvoiceLine(
        sequence=1,
        description="6 Side Machining",
        hsn_sac="998898",
        quantity=Decimal("16"),
        unit="NOS",
        rate=Decimal("767.50"),
        discount_percent=Decimal("0"),
        tax_rate=Decimal("18"),
        taxable_amount=Decimal("12280.00"),
        cgst_amount=Decimal("1105.20"),
        sgst_amount=Decimal("1105.20"),
        igst_amount=Decimal("0.00"),
    )
    totals = InvoiceTotals(
        total_taxable=Decimal("12280.00"),
        total_cgst=Decimal("1105.20"),
        total_sgst=Decimal("1105.20"),
        total_igst=Decimal("0.00"),
        raw_total=Decimal("14490.40"),
        round_off=Decimal("-0.40"),
        grand_total=Decimal("14490.00"),
    )
    invoice = Invoice(
        company_id=company.id,
        customer_id=customer.id,
        status=InvoiceStatus.FINALIZED,
        payment_status=PaymentStatus.UNPAID,
        invoice_number="SE/26-27/043",
        invoice_date="2026-05-11",
        place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
        references=InvoiceReferences(vehicle_number="MH48CQ5748"),
        lines=(line,),
        totals=totals,
    )
    repo.save(invoice)
    conn.commit()

    loaded = repo.get(invoice.id)
    assert loaded is not None
    assert loaded == invoice  # full round-trip incl Decimal totals and line
    # Exact paise stored (no precision loss).
    row = conn.execute(
        "SELECT rate_paise, taxable_paise FROM invoice_items WHERE invoice_id = ?",
        (str(invoice.id),),
    ).fetchone()
    assert row["rate_paise"] == 76750
    assert row["taxable_paise"] == 1228000
    hdr = conn.execute(
        "SELECT round_off_paise, grand_total_paise FROM invoices WHERE id = ?",
        (str(invoice.id),),
    ).fetchone()
    assert hdr["round_off_paise"] == -40
    assert hdr["grand_total_paise"] == 1449000


def test_invoice_fk_relationship_preserved(conn: sqlite3.Connection) -> None:
    company = Company(name="C")
    customer = Customer(name="Cust")
    SqliteCompanyRepository(conn).save(company)
    SqliteCustomerRepository(conn).save(customer)
    repo = SqliteInvoiceRepository(conn)
    invoice = Invoice(company_id=company.id, customer_id=customer.id)
    repo.save(invoice)
    conn.commit()
    loaded = repo.get(invoice.id)
    assert loaded is not None
    assert loaded.company_id == company.id
    assert loaded.customer_id == customer.id


def test_list_summaries_does_not_load_line_items(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    invoice = Invoice(
        lines=(InvoiceLine(description="x", quantity=Decimal("1"), rate=Decimal("1")),)
    )
    repo.save(invoice)
    conn.commit()
    summaries = repo.list_summaries()
    assert len(summaries) == 1
    assert summaries[0].lines == ()  # summary-only load (Req 21.3)
    # But get() loads the full invoice including lines.
    full = repo.get(invoice.id)
    assert full is not None and len(full.lines) == 1


def test_draft_round_trip_has_none_totals(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    draft = Invoice(references=InvoiceReferences(buyer_order_number="PO-1"))
    repo.save(draft)
    conn.commit()
    loaded = repo.get(draft.id)
    assert loaded is not None
    assert loaded.status is InvoiceStatus.DRAFT
    assert loaded.totals is None
    assert loaded.references.buyer_order_number == "PO-1"


def test_delete_draft_removes_invoice_and_lines(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    draft = Invoice(lines=(InvoiceLine(description="x", quantity=Decimal("1"), rate=Decimal("1")),))
    repo.save(draft)
    conn.commit()
    repo.delete_draft(draft.id)
    conn.commit()
    assert repo.get(draft.id) is None
    remaining = conn.execute(
        "SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?", (str(draft.id),)
    ).fetchone()["c"]
    assert remaining == 0
