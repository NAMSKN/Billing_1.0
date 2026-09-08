"""Integration tests for the draft lifecycle in InvoiceService."""

from __future__ import annotations

import sqlite3
from decimal import Decimal
from pathlib import Path

import pytest

from invoice_generator.application.invoice_service import (
    InvoiceService,
    InvoiceServiceError,
)
from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.domain.models import Invoice, InvoiceLine
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.invoice_repository import SqliteInvoiceRepository
from invoice_generator.infrastructure.db.migrator import apply_pending
from tests.support.id_factory import SequentialIdGenerator


@pytest.fixture
def service(tmp_path: Path) -> InvoiceService:
    conn: sqlite3.Connection = connect(tmp_path / "test.db")
    apply_pending(conn)
    return InvoiceService(
        conn,
        SqliteInvoiceRepository(conn),
        id_generator=SequentialIdGenerator(start=1),
    )


def test_create_draft_has_uuid_and_no_number(service: InvoiceService) -> None:
    draft = service.create_draft()
    assert draft.status is InvoiceStatus.DRAFT
    assert draft.invoice_number is None
    assert str(draft.id) == "00000000-0000-4000-8000-000000000001"
    # Persisted and retrievable.
    loaded = service.get(draft.id)
    assert loaded is not None
    assert loaded.invoice_number is None


def test_save_incomplete_draft_returns_warnings_not_errors(service: InvoiceService) -> None:
    draft = service.create_draft()
    result = service.save_draft(draft)
    assert result.is_ok is True  # no blocking issues for an incomplete draft
    assert any(i.field == "lines" for i in result.warnings)


def test_edit_draft_persists_changes(service: InvoiceService) -> None:
    draft = service.create_draft()
    edited = draft.model_copy(
        update={
            "notes": "call before dispatch",
            "lines": (
                InvoiceLine(description="Gundrilling", quantity=Decimal("16"), rate=Decimal("100")),
            ),
        }
    )
    service.save_draft(edited)
    loaded = service.get(draft.id)
    assert loaded is not None
    assert loaded.notes == "call before dispatch"
    assert len(loaded.lines) == 1
    assert loaded.invoice_number is None  # still no number


def test_delete_draft_removes_invoice_and_lines(service: InvoiceService) -> None:
    draft = service.create_draft(
        Invoice(lines=(InvoiceLine(description="x", quantity=Decimal("1"), rate=Decimal("1")),))
    )
    service.delete_draft(draft.id)
    assert service.get(draft.id) is None


def test_save_draft_rejects_finalized_invoice(service: InvoiceService) -> None:
    finalized = Invoice(status=InvoiceStatus.FINALIZED, invoice_number="SE/26-27/043")
    with pytest.raises(InvoiceServiceError):
        service.save_draft(finalized)


def test_save_draft_rejects_draft_with_number(service: InvoiceService) -> None:
    bogus = Invoice(status=InvoiceStatus.DRAFT, invoice_number="SE/26-27/043")
    with pytest.raises(InvoiceServiceError):
        service.save_draft(bogus)


def test_create_draft_forces_draft_state_and_clears_number(service: InvoiceService) -> None:
    # Even if given a finalized-looking invoice, create_draft yields a clean draft.
    seed = Invoice(status=InvoiceStatus.FINALIZED, invoice_number="SE/26-27/099", notes="copy me")
    draft = service.create_draft(seed)
    assert draft.status is InvoiceStatus.DRAFT
    assert draft.invoice_number is None
    assert draft.notes == "copy me"  # editable content carried over


def test_no_number_allocated_across_draft_saves(service: InvoiceService) -> None:
    draft = service.create_draft()
    service.save_draft(draft)
    service.save_draft(draft)
    loaded = service.get(draft.id)
    assert loaded is not None
    assert loaded.invoice_number is None
