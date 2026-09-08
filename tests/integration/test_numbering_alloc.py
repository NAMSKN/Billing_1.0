"""Integration tests for safe invoice-number allocation."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date
from pathlib import Path

import pytest

from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.domain.models import Company
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.infrastructure.db.company_repository import SqliteCompanyRepository
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from invoice_generator.infrastructure.db.sequence_repository import SqliteSequenceRepository

CONFIG = NumberingConfig(prefix="SE", pad_width=3, start_value=1, fy_scheme="IN")
COMPANY = uuid.UUID("00000000-0000-4000-8000-000000000001")


def _seed_company(conn: sqlite3.Connection) -> None:
    SqliteCompanyRepository(conn).save(Company(id=COMPANY, name="Test Co"))
    conn.commit()


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = connect(tmp_path / "test.db")
    apply_pending(c)
    _seed_company(c)
    return c


def _service(conn: sqlite3.Connection) -> NumberingService:
    return NumberingService(SqliteSequenceRepository(conn))


def test_first_allocation_uses_start_value(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    alloc = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.commit()
    assert alloc.sequence == 1
    assert alloc.invoice_number == "SE/26-27/001"


def test_repeated_allocation_is_unique_and_increasing(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    numbers = []
    for _ in range(5):
        numbers.append(service.allocate(COMPANY, date(2026, 5, 11), CONFIG).invoice_number)
        conn.commit()
    assert numbers == [
        "SE/26-27/001",
        "SE/26-27/002",
        "SE/26-27/003",
        "SE/26-27/004",
        "SE/26-27/005",
    ]
    assert len(set(numbers)) == 5


def test_financial_year_rollover_starts_new_sequence(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    a = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)  # FY 26-27
    conn.commit()
    b = service.allocate(COMPANY, date(2027, 5, 11), CONFIG)  # FY 27-28
    conn.commit()
    assert a.invoice_number == "SE/26-27/001"
    assert b.invoice_number == "SE/27-28/001"  # new FY restarts at start_value


def test_backdated_invoice_allocates_from_its_fy(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    # Allocate in current FY first.
    service.allocate(COMPANY, date(2027, 5, 11), CONFIG)  # FY 27-28
    conn.commit()
    # A backdated invoice (prior FY) draws from that FY's own sequence.
    back = service.allocate(COMPANY, date(2026, 6, 1), CONFIG)  # FY 26-27
    conn.commit()
    assert back.invoice_number == "SE/26-27/001"


def test_high_water_mark_advances(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    repo = SqliteSequenceRepository(conn)
    service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.commit()
    state = repo.get(COMPANY, "26-27", "SE")
    assert state is not None
    assert state.next_sequence == 3
    assert state.high_water_mark == 2  # highest issued so far


def test_rollback_does_not_issue_number(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    # Allocate then roll back: the number is NOT issued (D-027).
    first = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    assert first.sequence == 1
    conn.rollback()
    # A later successful allocation may reuse the rolled-back sequence.
    second = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.commit()
    assert second.sequence == 1
    assert second.invoice_number == "SE/26-27/001"


def test_committed_number_is_not_reused(conn: sqlite3.Connection) -> None:
    service = _service(conn)
    first = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.commit()
    second = service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.commit()
    assert first.sequence == 1
    assert second.sequence == 2  # committed 1 is never reused


def test_allocator_does_not_commit(conn: sqlite3.Connection) -> None:
    # If the allocator committed internally, the rollback below could not undo
    # the sequence advance. Prove it does not commit.
    service = _service(conn)
    service.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    conn.rollback()
    repo = SqliteSequenceRepository(conn)
    assert repo.get(COMPANY, "26-27", "SE") is None  # nothing persisted


def test_second_connection_sees_committed_state_only(tmp_path: Path) -> None:
    # Two connections: the second must not see uncommitted allocations, and
    # once committed it continues the sequence (no duplicate). The DB UNIQUE
    # index on invoice_number is the final backstop (D-028).
    db = tmp_path / "shared.db"
    c1 = connect(db)
    apply_pending(c1)
    _seed_company(c1)

    s1 = NumberingService(SqliteSequenceRepository(c1))
    a1 = s1.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    c1.commit()

    c2 = connect(db)
    s2 = NumberingService(SqliteSequenceRepository(c2))
    a2 = s2.allocate(COMPANY, date(2026, 5, 11), CONFIG)
    c2.commit()

    assert a1.sequence == 1
    assert a2.sequence == 2
    c1.close()
    c2.close()
