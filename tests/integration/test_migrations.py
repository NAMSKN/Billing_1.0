"""Integration tests for the schema migration runner."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from invoice_generator.infrastructure.db import migrator as migrator_module
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import (
    Migration,
    apply_pending,
    discover_migrations,
    latest_version,
)
from invoice_generator.infrastructure.db.schema import get_schema_version


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return connect(tmp_path / "test.db")


def test_discover_migrations_ordered_by_version() -> None:
    migrations = discover_migrations()
    versions = [m.version for m in migrations]
    assert versions == sorted(versions)
    assert 1 in versions  # the initial migration


def test_fresh_init_applies_all_and_sets_version(conn: sqlite3.Connection) -> None:
    applied = apply_pending(conn)
    assert applied == [m.version for m in discover_migrations()]
    assert get_schema_version(conn) == latest_version()
    # Core tables exist.
    tables = {
        r["name"]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"invoices", "invoice_items", "companies"}.issubset(tables)


def test_re_run_is_idempotent(conn: sqlite3.Connection) -> None:
    apply_pending(conn)
    version_after_first = get_schema_version(conn)
    applied_again = apply_pending(conn)
    assert applied_again == []  # nothing pending
    assert get_schema_version(conn) == version_after_first


def test_re_run_preserves_existing_data(conn: sqlite3.Connection) -> None:
    apply_pending(conn)
    invoice_id = str(uuid.uuid4())
    conn.execute("INSERT INTO invoices (id) VALUES (?)", (invoice_id,))
    conn.commit()
    apply_pending(conn)  # no-op
    row = conn.execute("SELECT id FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    assert row is not None and row["id"] == invoice_id


def test_version_bump_applies_only_new_migration(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Start at the real initial schema.
    apply_pending(conn)
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('k', 'v')")
    conn.commit()

    # Simulate a new migration 9999 arriving in a later release.
    real = discover_migrations()
    extra = Migration(
        version=9999,
        filename="9999_add_table.sql",
        sql="CREATE TABLE extra_feature (id TEXT PRIMARY KEY NOT NULL);",
    )
    monkeypatch.setattr(migrator_module, "discover_migrations", lambda: [*real, extra])

    applied = apply_pending(conn)
    assert applied == [9999]  # only the new one
    assert get_schema_version(conn) == 9999
    # Pre-existing data preserved.
    assert conn.execute("SELECT value FROM app_settings WHERE key='k'").fetchone()["value"] == "v"
    # New table created.
    tables = {
        r["name"]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "extra_feature" in tables


def test_duplicate_version_guard_rejects() -> None:
    from invoice_generator.infrastructure.db.migrator import check_unique_versions

    dup = [Migration(1, "0001_a.sql", ""), Migration(1, "0001_b.sql", "")]
    with pytest.raises(ValueError):
        check_unique_versions(dup)


def test_real_migrations_have_unique_versions() -> None:
    # Real discovery must not raise (unique versions).
    discover_migrations()
