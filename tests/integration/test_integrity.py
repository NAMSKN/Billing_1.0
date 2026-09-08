"""Integration tests for database + repository integrity invariants.

Covers: unique finalized invoice numbers, foreign-key integrity, status/payment
CHECK constraints, draft cascade delete, and that a finalized invoice is not
hard-deletable through the normal repository path (Req 23.3, 23.5).
"""

from __future__ import annotations

import sqlite3
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.domain.models import Company, Customer, Invoice, InvoiceLine
from invoice_generator.infrastructure.db.company_repository import SqliteCompanyRepository
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.customer_repository import SqliteCustomerRepository
from invoice_generator.infrastructure.db.invoice_repository import SqliteInvoiceRepository
from invoice_generator.infrastructure.db.migrator import apply_pending


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = connect(tmp_path / "test.db")
    apply_pending(c)
    return c


def _line() -> InvoiceLine:
    return InvoiceLine(description="x", quantity=Decimal("1"), rate=Decimal("1"))


# --- Unique finalized invoice number ---


def test_duplicate_finalized_number_rejected(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    first = Invoice(status=InvoiceStatus.FINALIZED, invoice_number="SE/26-27/043")
    repo.save(first)
    conn.commit()
    second = Invoice(status=InvoiceStatus.FINALIZED, invoice_number="SE/26-27/043")
    with pytest.raises(sqlite3.IntegrityError):
        repo.save(second)
    conn.rollback()


def test_many_drafts_share_null_number(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    repo.save(Invoice())
    repo.save(Invoice())
    repo.save(Invoice())
    conn.commit()
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM invoices WHERE invoice_number IS NULL"
    ).fetchone()["c"]
    assert count == 3


# --- Foreign-key integrity ---


def test_orphan_line_item_rejected(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO invoice_items (id, invoice_id, description) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), str(uuid.uuid4()), "orphan"),
        )


def test_valid_fk_relationships_accepted(conn: sqlite3.Connection) -> None:
    company = Company(name="C")
    customer = Customer(name="Cust")
    SqliteCompanyRepository(conn).save(company)
    SqliteCustomerRepository(conn).save(customer)
    repo = SqliteInvoiceRepository(conn)
    invoice = Invoice(company_id=company.id, customer_id=customer.id, lines=(_line(),))
    repo.save(invoice)
    conn.commit()
    loaded = repo.get(invoice.id)
    assert loaded is not None
    assert loaded.company_id == company.id


# --- Status CHECK constraints ---


def test_invalid_invoice_status_rejected(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO invoices (id, status) VALUES (?, ?)",
            (str(uuid.uuid4()), "SHIPPED"),
        )


def test_invalid_payment_status_rejected(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO invoices (id, payment_status) VALUES (?, ?)",
            (str(uuid.uuid4()), "REFUNDED"),
        )


def test_invalid_tax_treatment_rejected(conn: sqlite3.Connection) -> None:
    invoice_id = str(uuid.uuid4())
    conn.execute("INSERT INTO invoices (id) VALUES (?)", (invoice_id,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO invoice_items (id, invoice_id, tax_treatment) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), invoice_id, "EXEMPT"),
        )


# --- Draft cascade delete ---


def test_draft_delete_cascades_to_line_items(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    draft = Invoice(lines=(_line(), _line()))
    repo.save(draft)
    conn.commit()
    assert conn.execute(
        "SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?", (str(draft.id),)
    ).fetchone()["c"] == 2
    repo.delete_draft(draft.id)
    conn.commit()
    assert repo.get(draft.id) is None
    assert conn.execute(
        "SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?", (str(draft.id),)
    ).fetchone()["c"] == 0


# --- Finalized not hard-deletable via normal path ---


def test_finalized_not_deleted_by_delete_draft(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    finalized = Invoice(
        status=InvoiceStatus.FINALIZED,
        invoice_number="SE/26-27/044",
        lines=(_line(),),
    )
    repo.save(finalized)
    conn.commit()
    # The normal repository delete path only removes drafts.
    repo.delete_draft(finalized.id)
    conn.commit()
    still_there = repo.get(finalized.id)
    assert still_there is not None
    assert still_there.status is InvoiceStatus.FINALIZED


def test_cancelled_not_deleted_by_delete_draft(conn: sqlite3.Connection) -> None:
    repo = SqliteInvoiceRepository(conn)
    cancelled = Invoice(
        status=InvoiceStatus.CANCELLED,
        invoice_number="SE/26-27/045",
    )
    repo.save(cancelled)
    conn.commit()
    repo.delete_draft(cancelled.id)
    conn.commit()
    assert repo.get(cancelled.id) is not None
