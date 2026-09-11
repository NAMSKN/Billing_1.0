"""Tests for the dashboard controller and screen (Task 51)."""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.bootstrap import Application  # noqa: E402
from invoice_generator.domain.models import (  # noqa: E402
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.ui.dashboard.dashboard_controller import DashboardController  # noqa: E402
from invoice_generator.ui.dashboard.dashboard_screen import DashboardScreen  # noqa: E402
from tests.support.build_test_app import build_test_app  # noqa: E402

INVOICE_DATE = date(2026, 5, 11)


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _seed_company(app: Application) -> None:
    app.company_service_repo.save(
        Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
    )


def _finalize(app: Application, customer_name: str, when: date = INVOICE_DATE) -> Invoice:
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
    return app.invoice_service.finalize(draft.id, invoice_date=when)


# --- controller ---


def test_counts(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "Alpha")
        app.invoice_service.create_draft()  # a draft
        counts = DashboardController(app).counts()
        assert counts.total == 2
        assert counts.finalized == 1
        assert counts.draft == 1
        assert counts.cancelled == 0
    finally:
        app.close()


def test_recent_invoices_newest_first(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "Older", when=date(2026, 4, 1))
        _finalize(app, "Newer", when=date(2026, 6, 1))
        recent = DashboardController(app).recent_invoices()
        assert recent[0].customer == "Newer"  # newest date first
        assert recent[-1].customer == "Older"
    finally:
        app.close()


def test_recent_invoices_limit(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        for i in range(5):
            _finalize(app, f"Cust{i}")
        recent = DashboardController(app).recent_invoices(limit=3)
        assert len(recent) == 3
    finally:
        app.close()


def test_quick_search_by_customer(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "DI-TECH MOULDS")
        _finalize(app, "BMSS STEEL")
        rows = DashboardController(app).quick_search("bmss")
        assert len(rows) == 1
        assert rows[0].customer == "BMSS STEEL"
    finally:
        app.close()


def test_quick_search_by_number(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "Alpha")
        _finalize(app, "Beta")
        rows = DashboardController(app).quick_search("002")
        assert len(rows) == 1
        assert rows[0].number == "SE/26-27/002"
    finally:
        app.close()


def test_quick_search_empty_returns_recent(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "Alpha")
        rows = DashboardController(app).quick_search("")
        assert len(rows) == 1
    finally:
        app.close()


# --- widget (offscreen) ---


def test_screen_shows_recent(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "DI-TECH MOULDS")
        screen = DashboardScreen(DashboardController(app))
        assert screen.table.rowCount() == 1
        # Metric cards reflect the persisted data (redesigned dashboard).
        assert screen.card_total.value.text() == "1"
        assert screen.card_finalized.value.text() == "1"
    finally:
        app.close()


def test_screen_new_invoice_signal(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        screen = DashboardScreen(DashboardController(app))
        fired: list[bool] = []
        screen.new_invoice_requested.connect(lambda: fired.append(True))
        screen.new_invoice_button.click()
        assert fired == [True]
    finally:
        app.close()


def test_screen_quick_search_filters(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "DI-TECH MOULDS")
        _finalize(app, "BMSS STEEL")
        screen = DashboardScreen(DashboardController(app))
        assert screen.table.rowCount() == 2
        screen.search.setText("bmss")
        assert screen.table.rowCount() == 1
    finally:
        app.close()
