"""Offline invariant: core workflows make no runtime network call (Task 58).

Disables socket creation for the duration of each workflow so any attempt to
open a network connection raises, then drives the full chain — create draft →
finalize → PDF → search → backup → restore — and asserts it still succeeds. This
proves the product's offline-first invariant (Req 24): no cloud, server, or
network dependency at runtime.

References: requirements Req 24; DECISIONS D-014.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
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
from invoice_generator.infrastructure.backup.manifest import create_package
from invoice_generator.infrastructure.backup.restore import (
    reconcile_after_restore,
    restore_backup,
)
from invoice_generator.ui.invoices.invoice_list_controller import (
    InvoiceFilter,
    InvoiceListController,
)
from tests.support.build_test_app import build_test_app

INVOICE_DATE = date(2026, 5, 11)


class _NetworkBlockedError(RuntimeError):
    """Raised if any code attempts to create a network socket while offline."""


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Block all socket creation so any network attempt fails loudly."""

    def _blocked(*args: object, **kwargs: object) -> object:
        raise _NetworkBlockedError("network access attempted while offline")

    monkeypatch.setattr(socket, "socket", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    monkeypatch.setattr(socket, "socketpair", _blocked, raising=False)
    yield


def _seed_and_draft(tmp_path: Path) -> tuple[Application, Invoice]:
    """Create app + company + customer + a valid draft (outside the offline guard)."""
    app = build_test_app(tmp_path)
    app.company_service_repo.save(
        Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
    )
    customer = Customer(
        name="DI-TECH MOULDS",
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
    return app, draft


def test_socket_guard_actually_blocks(no_network: None) -> None:
    # Sanity: the guard really does raise on any socket attempt.
    with pytest.raises(_NetworkBlockedError):
        socket.socket()
    with pytest.raises(_NetworkBlockedError):
        socket.create_connection(("example.com", 80))


def test_full_workflow_succeeds_offline(tmp_path: Path, no_network: None) -> None:
    app, draft = _seed_and_draft(tmp_path)
    try:
        # 1. Finalize (allocates number, builds snapshot, persists) — no network.
        finalized = app.invoice_service.finalize(draft.id, invoice_date=INVOICE_DATE)
        assert finalized.invoice_number is not None

        # 2. PDF render — ReportLab is local; produces a non-trivial PDF.
        pdf_bytes = app.pdf_service.render(finalized)
        assert pdf_bytes.startswith(b"%PDF")
        assert len(pdf_bytes) > 1000

        # 3. Export PDF to disk.
        exported = app.pdf_service.export(finalized, tmp_path / "invoice.pdf")
        assert Path(exported).exists()

        # 4. Search / list — in-memory filtering over summaries.
        controller = InvoiceListController(app)
        rows = controller.list_rows(InvoiceFilter(customer_query="di-tech"))
        assert len(rows) == 1
        assert rows[0].number == finalized.invoice_number
    finally:
        app.close()

    # 5. Backup (online backup API + packaging) — local file I/O only.
    source_db = tmp_path / "invoices.db"
    package = create_package(
        source_db=source_db,
        schema_version=1,
        app_version="0.1.0",
        destination=tmp_path / "backups" / "backup.zip",
        created_at="2026-05-11T09:00:00+00:00",
    )
    assert package.exists()

    # 6. Restore + reconcile — local file I/O + SQLite only.
    result = restore_backup(package, database=source_db, safety_backup_dir=tmp_path / "safety")
    assert result.safety_backup.exists()

    reopened = build_test_app(tmp_path)
    try:
        metadata = reconcile_after_restore(
            reopened.connection, reopened.numbering_service, source_db
        )
        assert metadata.reconciliation_pending is False
        # The restored invoice is present and searchable.
        rows = InvoiceListController(reopened).list_rows()
        assert len(rows) == 1
    finally:
        reopened.close()
