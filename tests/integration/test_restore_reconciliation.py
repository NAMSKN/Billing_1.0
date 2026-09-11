"""Tests for numbering reconciliation after restore (Task 56).

Verifies the D-029 safe interim (OPEN_QUESTIONS Q-009): after a restore, new
invoice-number issuance is blocked until reconciliation is confirmed; each
numbering scope is advanced past its captured pre-restore trusted high-water
mark (NOT the restored backup's internal mark); scopes reconcile independently.

References: requirements Req 15.5; DECISIONS D-029; OPEN_QUESTIONS Q-009.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date
from pathlib import Path

import pytest

from invoice_generator.application.errors import ReconciliationPendingError
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.unit_of_work import UnitOfWork
from invoice_generator.domain.models import SequenceState
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.infrastructure.backup.restore import (
    MetadataReconciliationGate,
    ScopeHighWater,
    reconcile_after_restore,
    write_reconciliation_metadata,
)
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from invoice_generator.infrastructure.db.sequence_repository import SqliteSequenceRepository

FY = "26-27"
PREFIX = "SE"
COMPANY_A = uuid.UUID("00000000-0000-4000-8000-00000000000a")
COMPANY_B = uuid.UUID("00000000-0000-4000-8000-00000000000b")


def _seed_company(conn: sqlite3.Connection, company: uuid.UUID) -> None:
    """Insert a minimal company row so the sequence FK is satisfied."""
    conn.execute(
        "INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)",
        (str(company), "Test Co"),
    )


def _seed_scope(
    conn: sqlite3.Connection,
    repo: SqliteSequenceRepository,
    company: uuid.UUID,
    high_water: int,
) -> None:
    _seed_company(conn, company)
    repo.save(
        SequenceState(
            company_id=company,
            financial_year=FY,
            prefix=PREFIX,
            next_sequence=high_water + 1,
            high_water_mark=high_water,
        )
    )


# --- reconcile_scope (advancing past trusted high-water) ---


def test_reconcile_scope_advances_past_trusted(tmp_path: Path) -> None:
    conn = connect(tmp_path / "db.sqlite")
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        # Restored DB lags: it thinks next is 46 (high-water 45)...
        _seed_scope(conn, repo, COMPANY_A, high_water=45)
        service = NumberingService(repo)
        # ...but the trusted pre-restore high-water was 48.
        with UnitOfWork(conn):
            reconciled = service.reconcile_scope(COMPANY_A, FY, PREFIX, trusted_high_water_mark=48)
        assert reconciled.next_sequence == 49  # advanced past 48, not 46
        assert reconciled.high_water_mark == 48
    finally:
        conn.close()


def test_reconcile_scope_never_rolls_back_an_ahead_scope(tmp_path: Path) -> None:
    conn = connect(tmp_path / "db.sqlite")
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        _seed_scope(conn, repo, COMPANY_A, high_water=50)  # already ahead
        service = NumberingService(repo)
        with UnitOfWork(conn):
            reconciled = service.reconcile_scope(COMPANY_A, FY, PREFIX, trusted_high_water_mark=48)
        assert reconciled.next_sequence == 51  # unchanged, monotonic
        assert reconciled.high_water_mark == 50
    finally:
        conn.close()


# --- issuance gate ---


def test_allocate_blocked_while_reconciliation_pending(tmp_path: Path) -> None:
    conn = connect(tmp_path / "db.sqlite")
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        _seed_scope(conn, repo, COMPANY_A, high_water=45)

        class _PendingGate:
            def is_reconciliation_pending(self) -> bool:
                return True

        service = NumberingService(repo, reconciliation_gate=_PendingGate())
        with UnitOfWork(conn), pytest.raises(ReconciliationPendingError):
            service.allocate(COMPANY_A, date(2026, 5, 11), NumberingConfig())
    finally:
        conn.close()


def test_allocate_allowed_after_reconciliation_confirmed(tmp_path: Path) -> None:
    db = tmp_path / "db.sqlite"
    conn = connect(db)
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        _seed_scope(conn, repo, COMPANY_A, high_water=45)
        gate = MetadataReconciliationGate(db)
        service = NumberingService(repo, reconciliation_gate=gate)

        # Pending: blocked.
        write_reconciliation_metadata(
            db,
            (),  # scopes captured separately below; empty is fine for the gate
            reconciliation_pending=True,
        )
        with UnitOfWork(conn), pytest.raises(ReconciliationPendingError):
            service.allocate(COMPANY_A, date(2026, 5, 11), NumberingConfig())

        # Confirm (clear pending); issuance allowed again.
        write_reconciliation_metadata(db, (), reconciliation_pending=False)
        with UnitOfWork(conn):
            allocation = service.allocate(COMPANY_A, date(2026, 5, 11), NumberingConfig())
        assert allocation.sequence == 46  # next after restored high-water 45
    finally:
        conn.close()


# --- end-to-end reconcile_after_restore ---


def test_reconcile_after_restore_uses_trusted_state_not_restored_mark(tmp_path: Path) -> None:
    # Scenario: backup at 45; later 46/47/48 issued; restore reverts DB to 45;
    # reconcile must advance past 48 (trusted), not reuse 46.
    db = tmp_path / "db.sqlite"
    conn = connect(db)
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        # Restored (older) DB internal mark is 45.
        _seed_scope(conn, repo, COMPANY_A, high_water=45)
        # Preserved pre-restore trusted state says the scope reached 48.
        write_reconciliation_metadata(
            db,
            (ScopeHighWater(str(COMPANY_A), FY, PREFIX, high_water_mark=48),),
            reconciliation_pending=True,
        )
        service = NumberingService(repo, reconciliation_gate=MetadataReconciliationGate(db))

        # Blocked before reconciliation.
        with UnitOfWork(conn), pytest.raises(ReconciliationPendingError):
            service.allocate(COMPANY_A, date(2026, 5, 11), NumberingConfig())

        result = reconcile_after_restore(conn, service, db)
        assert result.reconciliation_pending is False

        # Now issuance is allowed and the next number is 49 (past trusted 48).
        with UnitOfWork(conn):
            allocation = service.allocate(COMPANY_A, date(2026, 5, 11), NumberingConfig())
        assert allocation.sequence == 49
    finally:
        conn.close()


def test_scopes_reconcile_independently(tmp_path: Path) -> None:
    db = tmp_path / "db.sqlite"
    conn = connect(db)
    apply_pending(conn)
    try:
        repo = SqliteSequenceRepository(conn)
        _seed_scope(conn, repo, COMPANY_A, high_water=10)
        _seed_scope(conn, repo, COMPANY_B, high_water=20)
        write_reconciliation_metadata(
            db,
            (
                ScopeHighWater(str(COMPANY_A), FY, PREFIX, high_water_mark=30),
                ScopeHighWater(str(COMPANY_B), FY, PREFIX, high_water_mark=25),
            ),
            reconciliation_pending=True,
        )
        service = NumberingService(repo, reconciliation_gate=MetadataReconciliationGate(db))

        reconcile_after_restore(conn, service, db)

        state_a = repo.get(COMPANY_A, FY, PREFIX)
        state_b = repo.get(COMPANY_B, FY, PREFIX)
        assert state_a is not None
        assert state_b is not None
        assert state_a.next_sequence == 31  # advanced past 30
        assert state_b.next_sequence == 26  # advanced past 25, independently
    finally:
        conn.close()

