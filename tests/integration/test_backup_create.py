"""Tests for consistent SQLite backup creation (Task 52).

Verifies the online backup API is used (consistent snapshot, not a raw file
copy during writes) and that data — including UUID entity ids — is preserved.

References: requirements Req 15.1, 30.6; DECISIONS D-018.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from invoice_generator.domain.models import Address, Company
from invoice_generator.infrastructure.backup.backup import create_backup
from tests.support.build_test_app import build_test_app


def _seed_company(tmp_path: Path) -> str:
    """Create one company in a fresh temp DB and return its UUID id."""
    app = build_test_app(tmp_path)
    try:
        company = Company(
            name="Suntech Moulds",
            address=Address(state_name="Maharashtra", state_code="27"),
        )
        app.company_service_repo.save(company)
        return str(company.id)
    finally:
        app.close()


def test_backup_creates_openable_sqlite_file(tmp_path: Path) -> None:
    _seed_company(tmp_path)
    source = tmp_path / "invoices.db"
    dest = tmp_path / "backups" / "snapshot.db"

    result = create_backup(source, dest)

    assert result == dest
    assert dest.exists()
    # The snapshot opens as a valid SQLite database.
    conn = sqlite3.connect(dest)
    try:
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        assert integrity == "ok"
    finally:
        conn.close()


def test_backup_preserves_uuids(tmp_path: Path) -> None:
    company_id = _seed_company(tmp_path)
    source = tmp_path / "invoices.db"
    dest = tmp_path / "snapshot.db"

    create_backup(source, dest)

    conn = sqlite3.connect(dest)
    try:
        rows = conn.execute("SELECT id FROM companies").fetchall()
    finally:
        conn.close()
    assert [r[0] for r in rows] == [company_id]


def test_backup_matches_source_row_counts(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        for i in range(3):
            app.company_service_repo.save(
                Company(
                    name=f"Company {i}",
                    address=Address(state_name="Maharashtra", state_code="27"),
                )
            )
    finally:
        app.close()

    source = tmp_path / "invoices.db"
    dest = tmp_path / "snapshot.db"
    create_backup(source, dest)

    conn = sqlite3.connect(dest)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM companies").fetchone()
    finally:
        conn.close()
    assert count == 3


def test_backup_is_consistent_snapshot_during_open_write(tmp_path: Path) -> None:
    """Online backup API yields a consistent snapshot even with a live writer.

    A raw file copy during an uncommitted write could capture a torn/partial
    file. The online backup API copies pages under SQLite locking, so the
    snapshot reflects committed state and passes integrity_check.
    """
    committed_id = _seed_company(tmp_path)
    source = tmp_path / "invoices.db"

    # Hold an open connection with an uncommitted write against the source.
    writer = sqlite3.connect(source)
    try:
        writer.execute("BEGIN IMMEDIATE")
        writer.execute(
            "INSERT INTO companies (id, name, state_name, state_code) "
            "VALUES (?, ?, ?, ?)",
            ("11111111-1111-4111-8111-111111111111", "Uncommitted", "Goa", "30"),
        )
        # Do NOT commit; back up while the write is pending.
        dest = tmp_path / "snapshot.db"
        create_backup(source, dest)
    finally:
        writer.rollback()
        writer.close()

    conn = sqlite3.connect(dest)
    try:
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        ids = [r[0] for r in conn.execute("SELECT id FROM companies").fetchall()]
    finally:
        conn.close()
    assert integrity == "ok"
    # Only committed data is present; the uncommitted row is excluded.
    assert committed_id in ids
    assert "11111111-1111-4111-8111-111111111111" not in ids


def test_backup_creates_parent_directory(tmp_path: Path) -> None:
    _seed_company(tmp_path)
    source = tmp_path / "invoices.db"
    dest = tmp_path / "nested" / "deeper" / "snapshot.db"

    create_backup(source, dest)

    assert dest.exists()


def test_backup_overwrites_existing_destination(tmp_path: Path) -> None:
    _seed_company(tmp_path)
    source = tmp_path / "invoices.db"
    dest = tmp_path / "snapshot.db"
    dest.write_bytes(b"stale not-a-database contents")

    create_backup(source, dest)

    conn = sqlite3.connect(dest)
    try:
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
    finally:
        conn.close()
    assert integrity == "ok"


def test_backup_missing_source_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        create_backup(tmp_path / "does-not-exist.db", tmp_path / "snapshot.db")
