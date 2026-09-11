"""Tests for the invoice history controller and screen (Task 50)."""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.bootstrap import Application  # noqa: E402
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus  # noqa: E402
from invoice_generator.domain.models import (  # noqa: E402
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.ui.invoices.invoice_list import InvoiceListScreen  # noqa: E402
from invoice_generator.ui.invoices.invoice_list_controller import (  # noqa: E402
    InvoiceFilter,
    InvoiceListController,
)
from tests.support.build_test_app import build_test_app  # noqa: E402

INVOICE_DATE = date(2026, 5, 11)


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _seed_company(app: Application) -> None:
    app.company_service_repo.save(
        Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
    )


def _finalize_for(app: Application, customer_name: str, *, job: str = "DT-663") -> Invoice:
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
                    job_or_mould_reference=job,
                    hsn_sac="998898",
                    quantity=Decimal("16"),
                    unit="NOS",
                    rate=Decimal("767.50"),
                    tax_rate=Decimal("18"),
                ),
            ),
        )
    )
    return app.invoice_service.finalize(draft.id, invoice_date=INVOICE_DATE)


# --- controller ---


def test_list_rows_columns(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "DI-TECH MOULDS")
        rows = app_controller(app).list_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row.number == "SE/26-27/001"
        assert row.customer == "DI-TECH MOULDS"
        assert row.job_or_mould == "DT-663"
        assert row.total == "14,490.00"
        assert row.status == "FINALIZED"
        assert row.payment_status == "UNPAID"
    finally:
        app.close()


def test_filter_by_number(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "Alpha")
        _finalize_for(app, "Beta")
        ctrl = app_controller(app)
        rows = ctrl.list_rows(InvoiceFilter(number_query="002"))
        assert len(rows) == 1
        assert rows[0].number == "SE/26-27/002"
    finally:
        app.close()


def test_filter_by_customer(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "DI-TECH MOULDS")
        _finalize_for(app, "BMSS STEEL")
        ctrl = app_controller(app)
        rows = ctrl.list_rows(InvoiceFilter(customer_query="bmss"))
        assert len(rows) == 1
        assert rows[0].customer == "BMSS STEEL"
    finally:
        app.close()


def test_filter_by_status(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "Alpha")
        app.invoice_service.create_draft()  # a draft
        ctrl = app_controller(app)
        finalized = ctrl.list_rows(InvoiceFilter(status=InvoiceStatus.FINALIZED))
        drafts = ctrl.list_rows(InvoiceFilter(status=InvoiceStatus.DRAFT))
        assert len(finalized) == 1
        assert len(drafts) == 1
    finally:
        app.close()


def test_filter_by_date_range(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "Alpha")  # dated 2026-05-11
        ctrl = app_controller(app)
        in_range = ctrl.list_rows(
            InvoiceFilter(date_from=date(2026, 5, 1), date_to=date(2026, 5, 31))
        )
        assert len(in_range) == 1
        assert len(ctrl.list_rows(InvoiceFilter(date_from=date(2026, 6, 1)))) == 0
    finally:
        app.close()


def test_filter_by_payment_status(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        inv = _finalize_for(app, "Alpha")
        app.invoice_service.set_payment_status(inv.id, PaymentStatus.PAID)
        ctrl = app_controller(app)
        assert len(ctrl.list_rows(InvoiceFilter(payment_status=PaymentStatus.PAID))) == 1
        assert len(ctrl.list_rows(InvoiceFilter(payment_status=PaymentStatus.UNPAID))) == 0
    finally:
        app.close()


def test_actions_preview_export_duplicate_cancel(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        inv = _finalize_for(app, "Alpha")
        ctrl = app_controller(app)
        # preview
        assert ctrl.preview_bytes(inv.id).startswith(b"%PDF-")
        # export
        out = ctrl.export(inv.id, str(tmp_path / "out.pdf"))
        assert Path(out).read_bytes().startswith(b"%PDF-")
        # duplicate -> new draft
        dup = ctrl.duplicate(inv.id)
        assert dup.status is InvoiceStatus.DRAFT
        assert dup.id != inv.id
        # cancel
        cancelled = ctrl.cancel(inv.id, "correction")
        assert cancelled.status is InvoiceStatus.CANCELLED
    finally:
        app.close()


def app_controller(app: Application) -> InvoiceListController:
    return InvoiceListController(app)


# --- widget (offscreen) ---


def test_screen_columns_no_uuid(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        screen = InvoiceListScreen(app_controller(app))
        headers = [
            screen.table.horizontalHeaderItem(i).text()
            for i in range(screen.table.columnCount())
        ]
        assert headers == ["Number", "Date", "Customer", "Job/Mould", "Total", "Status", "Payment"]
        assert not any("id" in h.lower() or "uuid" in h.lower() for h in headers)
    finally:
        app.close()


def test_screen_lists_and_filters(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "DI-TECH MOULDS")
        _finalize_for(app, "BMSS STEEL")
        screen = InvoiceListScreen(app_controller(app))
        assert screen.table.rowCount() == 2
        screen.customer_search.setText("bmss")
        assert screen.table.rowCount() == 1
    finally:
        app.close()


def test_screen_duplicate_selected(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize_for(app, "Alpha")
        screen = InvoiceListScreen(app_controller(app))
        screen.table.selectRow(0)
        assert screen.duplicate_selected() is True
        # A new draft now exists alongside the finalized invoice.
        assert screen.table.rowCount() == 2
    finally:
        app.close()
