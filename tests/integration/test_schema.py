"""Integration tests for the initial SQLite schema."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.schema import (
    INITIAL_SCHEMA_VERSION,
    apply_initial_schema,
    get_schema_version,
)

EXPECTED_TABLES = {
    "companies",
    "customers",
    "assets",
    "numbering_config",
    "invoice_sequences",
    "invoices",
    "invoice_items",
    "service_templates",
    "app_settings",
    "schema_version",
}


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = connect(tmp_path / "test.db")
    apply_initial_schema(conn)
    return conn


def test_all_tables_created(db: sqlite3.Connection) -> None:
    rows = db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    names = {r["name"] for r in rows}
    assert EXPECTED_TABLES.issubset(names)


def test_schema_version_stamped(db: sqlite3.Connection) -> None:
    assert get_schema_version(db) == INITIAL_SCHEMA_VERSION


def test_no_autoincrement_anywhere(db: sqlite3.Connection) -> None:
    rows = db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL"
    ).fetchall()
    for row in rows:
        assert "AUTOINCREMENT" not in row["sql"].upper()


def test_primary_key_columns_are_text_uuid(db: sqlite3.Connection) -> None:
    for table in ("companies", "customers", "assets", "invoices", "invoice_items"):
        info = db.execute(f"PRAGMA table_info({table})").fetchall()
        pk_cols = [c for c in info if c["pk"] > 0]
        assert pk_cols, f"{table} has no primary key"
        for col in pk_cols:
            assert col["type"] == "TEXT", f"{table}.{col['name']} pk is {col['type']}"


def test_foreign_keys_enforced(db: sqlite3.Connection) -> None:
    # invoice_items.invoice_id references a non-existent invoice -> rejected.
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO invoice_items (id, invoice_id) VALUES (?, ?)",
            (str(uuid.uuid4()), str(uuid.uuid4())),
        )


def test_invoice_status_check_constraint(db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO invoices (id, status) VALUES (?, ?)",
            (str(uuid.uuid4()), "BOGUS"),
        )


def test_payment_status_check_constraint(db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO invoices (id, payment_status) VALUES (?, ?)",
            (str(uuid.uuid4()), "OVERDUE"),
        )


def test_invoice_number_unique_when_present(db: sqlite3.Connection) -> None:
    db.execute(
        "INSERT INTO invoices (id, status, invoice_number) VALUES (?, 'FINALIZED', ?)",
        (str(uuid.uuid4()), "SE/26-27/043"),
    )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO invoices (id, status, invoice_number) VALUES (?, 'FINALIZED', ?)",
            (str(uuid.uuid4()), "SE/26-27/043"),
        )


def test_multiple_drafts_may_have_null_invoice_number(db: sqlite3.Connection) -> None:
    # Partial unique index excludes NULLs: many drafts can coexist.
    db.execute("INSERT INTO invoices (id) VALUES (?)", (str(uuid.uuid4()),))
    db.execute("INSERT INTO invoices (id) VALUES (?)", (str(uuid.uuid4()),))
    count = db.execute(
        "SELECT COUNT(*) AS c FROM invoices WHERE invoice_number IS NULL"
    ).fetchone()["c"]
    assert count == 2


def test_draft_delete_cascades_to_items(db: sqlite3.Connection) -> None:
    invoice_id = str(uuid.uuid4())
    db.execute("INSERT INTO invoices (id) VALUES (?)", (invoice_id,))
    db.execute(
        "INSERT INTO invoice_items (id, invoice_id, description) VALUES (?, ?, ?)",
        (str(uuid.uuid4()), invoice_id, "line"),
    )
    db.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
    remaining = db.execute(
        "SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?", (invoice_id,)
    ).fetchone()["c"]
    assert remaining == 0


def test_money_columns_are_integer(db: sqlite3.Connection) -> None:
    info = db.execute("PRAGMA table_info(invoices)").fetchall()
    types = {c["name"]: c["type"] for c in info}
    for col in (
        "total_taxable_paise",
        "total_cgst_paise",
        "raw_total_paise",
        "round_off_paise",
        "grand_total_paise",
    ):
        assert types[col] == "INTEGER"
