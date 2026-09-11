"""Tests for the restore workflow (Task 54).

Verifies the pre-restore trusted numbering state is captured and survives the
database being replaced, that a valid backup restores atomically, and that an
invalid/tampered backup is rejected without touching the live database.

References: requirements Req 15.3; DECISIONS D-029.
"""

from __future__ import annotations

import sqlite3
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.bootstrap import Application
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.infrastructure.backup.manifest import DATABASE_ENTRY, create_package
from invoice_generator.infrastructure.backup.restore import (
    SAFETY_BACKUP_PREFIX,
    RestoreError,
    capture_trusted_state,
    create_safety_backup,
    read_reconciliation_metadata,
    reconciliation_metadata_path,
    restore_backup,
)
from tests.support.build_test_app import build_test_app
from tests.support.id_factory import SequentialIdGenerator

APP_VERSION = "0.1.0"
SCHEMA_VERSION = 1
CREATED_AT = "2026-05-11T09:00:00+00:00"


def _ensure_company(app: Application) -> Company:
    """Create the single company once, reusing it if already present."""
    existing = app.company_service_repo.get_active()
    if existing is not None:
        return existing
    company = Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
    app.company_service_repo.save(company)
    return company


def _finalize_one(app: Application, customer_name: str, when: date) -> None:
    """Finalize one invoice for the single company (same numbering scope)."""
    _ensure_company(app)
    customer = Customer(
        name=customer_name,
        bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code="27"),
    )
    app.customer_service_repo.save(customer)
    draft = app.invoice_service.create_draft(
        Invoice(
            customer_id=customer.id,
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
    app.invoice_service.finalize(draft.id, invoice_date=when)


def _seed_db_with_numbering(tmp_path: Path) -> Path:
    """Create a live DB and issue one invoice so numbering state exists."""
    app = build_test_app(tmp_path)
    try:
        _finalize_one(app, "Alpha", when=date(2026, 5, 11))
    finally:
        app.close()
    return tmp_path / "invoices.db"


def _issue_second_invoice(tmp_path: Path) -> None:
    """Issue a second invoice in the SAME numbering scope (advances high-water).

    Uses a disjoint id range so the new customer/invoice do not collide with the
    seeded ids, while ``_ensure_company`` reuses the persisted company so both
    invoices share one numbering scope (company/FY/prefix).
    """
    app = build_test_app(tmp_path, id_generator=SequentialIdGenerator(start=100))
    try:
        _finalize_one(app, "Beta", when=date(2026, 6, 1))
    finally:
        app.close()


def _make_package(source_db: Path, dest: Path) -> Path:
    return create_package(
        source_db=source_db,
        schema_version=SCHEMA_VERSION,
        app_version=APP_VERSION,
        destination=dest,
        created_at=CREATED_AT,
    )


# --- capture trusted state ---


def test_capture_trusted_state_reads_high_water(tmp_path: Path) -> None:
    db = _seed_db_with_numbering(tmp_path)
    scopes = capture_trusted_state(db)
    assert len(scopes) == 1
    assert scopes[0].high_water_mark >= 1


def test_capture_trusted_state_empty_when_no_numbering(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    app.close()
    scopes = capture_trusted_state(tmp_path / "invoices.db")
    assert scopes == ()


# --- restore happy path ---


def test_valid_backup_restores(tmp_path: Path) -> None:
    # Old state: 1 invoice. Package it. Then issue more; restore should revert
    # the DB contents to the packaged snapshot.
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backups" / "backup.zip")

    _issue_second_invoice(tmp_path)

    conn = sqlite3.connect(source)
    try:
        (before,) = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()
    finally:
        conn.close()
    assert before == 2  # two invoices now

    restore_backup(pkg, database=source)

    conn = sqlite3.connect(source)
    try:
        (after,) = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()
    finally:
        conn.close()
    assert after == 1  # reverted to the packaged single-invoice snapshot


def test_trusted_state_captured_before_restore_and_survives(tmp_path: Path) -> None:
    # Backup taken at high-water 1; then issue a second invoice (high-water 2).
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backup.zip")

    _issue_second_invoice(tmp_path)
    current_high_water = capture_trusted_state(source)[0].high_water_mark
    assert current_high_water == 2

    result = restore_backup(pkg, database=source)
    metadata = result.metadata

    # The preserved trusted state reflects the CURRENT (pre-restore) high-water
    # of 2, NOT the restored backup's internal mark of 1 (D-029).
    assert metadata.reconciliation_pending is True
    assert len(metadata.scopes) == 1
    assert metadata.scopes[0].high_water_mark == 2

    # And it survives on disk, outside the replaced database file.
    meta_path = reconciliation_metadata_path(source)
    assert meta_path.exists()
    on_disk = read_reconciliation_metadata(source)
    assert on_disk is not None
    assert on_disk.scopes[0].high_water_mark == 2


def test_restored_db_internal_mark_is_the_old_value(tmp_path: Path) -> None:
    # Confirms the *restored database* carries the old mark (1); reconciliation
    # (Task 56) must therefore rely on the preserved trusted state, not this.
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backup.zip")
    _issue_second_invoice(tmp_path)

    restore_backup(pkg, database=source)

    conn = sqlite3.connect(source)
    try:
        (mark,) = conn.execute("SELECT high_water_mark FROM invoice_sequences").fetchone()
    finally:
        conn.close()
    assert mark == 1  # the older backup's internal mark


# --- invalid backup rejected ---


def test_invalid_backup_rejected(tmp_path: Path) -> None:
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backup.zip")
    # Tamper: corrupt the packaged database.
    with zipfile.ZipFile(pkg) as archive:
        items = {n: archive.read(n) for n in archive.namelist()}
    items[DATABASE_ENTRY] = b"corrupted"
    with zipfile.ZipFile(pkg, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in items.items():
            archive.writestr(name, data)

    with pytest.raises(RestoreError):
        restore_backup(pkg, database=source)


def test_invalid_backup_leaves_live_db_untouched(tmp_path: Path) -> None:
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backup.zip")
    # Add a second invoice so the live DB has 2 rows.
    _issue_second_invoice(tmp_path)
    # Corrupt the package.
    pkg.write_bytes(b"not a zip")

    with pytest.raises(RestoreError):
        restore_backup(pkg, database=source)

    conn = sqlite3.connect(source)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()
    finally:
        conn.close()
    assert count == 2  # live DB unchanged by the failed restore


# --- safety backup before restore (Task 55) ---


def test_create_safety_backup_is_consistent_snapshot(tmp_path: Path) -> None:
    source = _seed_db_with_numbering(tmp_path)
    backups = tmp_path / "backups"

    safety = create_safety_backup(source, backups, timestamp="20260511T090000Z")

    assert safety.exists()
    assert safety.parent == backups
    assert safety.name.startswith(SAFETY_BACKUP_PREFIX)
    conn = sqlite3.connect(safety)
    try:
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        (count,) = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()
    finally:
        conn.close()
    assert integrity == "ok"
    assert count == 1  # snapshot of current data


def test_safety_backup_does_not_overwrite_existing(tmp_path: Path) -> None:
    source = _seed_db_with_numbering(tmp_path)
    backups = tmp_path / "backups"

    first = create_safety_backup(source, backups, timestamp="20260511T090000Z")
    second = create_safety_backup(source, backups, timestamp="20260511T090000Z")

    assert first.exists()
    assert second.exists()
    assert first != second  # same timestamp does not clobber the earlier one


def test_restore_creates_safety_backup_of_current_data(tmp_path: Path) -> None:
    # Backup packaged at 1 invoice; live DB advanced to 2; restore should first
    # preserve the current (2-invoice) data in a safety backup, no silent loss.
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "backup.zip")
    _issue_second_invoice(tmp_path)

    backups = tmp_path / "safety"
    result = restore_backup(pkg, database=source, safety_backup_dir=backups)

    assert result.safety_backup.exists()
    assert result.safety_backup.parent == backups
    # The safety backup holds the pre-restore data (2 invoices), not the
    # restored snapshot (1 invoice).
    conn = sqlite3.connect(result.safety_backup)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()
    finally:
        conn.close()
    assert count == 2


def test_safety_backup_defaults_beside_database(tmp_path: Path) -> None:
    source = _seed_db_with_numbering(tmp_path)
    pkg = _make_package(source, tmp_path / "pkg" / "backup.zip")
    _issue_second_invoice(tmp_path)

    result = restore_backup(pkg, database=source)

    assert result.safety_backup.parent == source.parent
    assert result.safety_backup.exists()
