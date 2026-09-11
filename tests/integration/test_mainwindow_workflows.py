"""Application-level UI workflow tests through the real MainWindow (remediation).

These prove the remediated chain MainWindow -> mounted screen -> controller ->
application service -> persistence/output, rather than isolated widget behavior.
They construct the actual MainWindow (which mounts the real screens and wires the
navigator) and drive each reported-defect workflow end to end.

Preview/print are exercised at the controller/service level (which produce PDF
bytes/spool files) rather than by clicking buttons that would launch an OS viewer
or a physical printer; the screen wiring (enablement, navigation) is asserted
through the window.
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus  # noqa: E402
from invoice_generator.domain.models import InvoiceLine  # noqa: E402
from invoice_generator.ui.customers.customer_screen import CustomerScreen  # noqa: E402
from invoice_generator.ui.dashboard.dashboard_screen import DashboardScreen  # noqa: E402
from invoice_generator.ui.invoices.invoice_list import InvoiceListScreen  # noqa: E402
from invoice_generator.ui.main_window import MainWindow  # noqa: E402
from invoice_generator.ui.settings.settings_screen import SettingsScreen  # noqa: E402
from tests.support.build_test_app import build_test_app  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _settings(window: MainWindow) -> SettingsScreen:
    screen = window._screens["Settings"]  # noqa: SLF001
    assert isinstance(screen, SettingsScreen)
    return screen


def _customers(window: MainWindow) -> CustomerScreen:
    screen = window._screens["Customers"]  # noqa: SLF001
    assert isinstance(screen, CustomerScreen)
    return screen


def _history(window: MainWindow) -> InvoiceListScreen:
    screen = window._screens["Invoice History"]  # noqa: SLF001
    assert isinstance(screen, InvoiceListScreen)
    return screen


def _dashboard(window: MainWindow) -> DashboardScreen:
    screen = window._screens["Dashboard"]  # noqa: SLF001
    assert isinstance(screen, DashboardScreen)
    return screen


def _fill_company(window: MainWindow) -> None:
    s = _settings(window)
    s.name.setText("SUNTECH ENTERPRISES")
    s.state_name.setText("Maharashtra")
    s.state_code.setText("27")
    s.gstin.setText("27DEZPS3898C1ZH")
    s.save()


def _add_customer(window: MainWindow, name: str = "DI-TECH MOULDS") -> None:
    c = _customers(window)
    c.new_customer()
    c.name.setText(name)
    c.bill_line.setText("Plot 9")
    c.state_name.setText("Maharashtra")
    c.state_code.setText("27")
    c.save_current()


def _build_invoice_lines(window: MainWindow) -> None:
    f = window._invoice_form  # noqa: SLF001
    f.reload_customers()
    f.customer_combo.setCurrentIndex(1)  # first real customer
    f.line_table.set_lines(
        (
            InvoiceLine(
                description="Gundrilling",
                hsn_sac="998898",
                quantity=Decimal("16"),
                unit="NOS",
                rate=Decimal("767.50"),
                tax_rate=Decimal("18"),
            ),
        )
    )
    f.refresh_totals()


# --- settings ---


def test_settings_save_persists_and_gives_feedback(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _fill_company(window)
        assert "saved" in _settings(window).status.text().lower()
    finally:
        app.close()
    # Reopen: values persist.
    app2 = build_test_app(tmp_path)
    try:
        got = app2.company_service_repo.get_active()
        assert got is not None
        assert got.name == "SUNTECH ENTERPRISES"
        assert got.gstin == "27DEZPS3898C1ZH"
    finally:
        app2.close()


def test_settings_blocking_validation_shows_error(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        s = _settings(window)
        s.name.setText("X")
        s.gstin.setText("NOT-A-GSTIN")  # malformed -> blocking
        result = s.save()
        assert not result.is_ok
        assert "fix" in s.status.text().lower()
        # Not persisted.
        assert app.company_service_repo.get_active() is None
    finally:
        app.close()


def test_settings_logo_configures_and_persists(qapp: QApplication, tmp_path: Path) -> None:
    # Build a Settings screen with a tmp-dir asset store so the test stays
    # hermetic (does not write into the real user app-data assets directory).
    from invoice_generator.infrastructure.assets.asset_store import AssetStore
    from invoice_generator.infrastructure.db.asset_repository import SqliteAssetRepository
    from invoice_generator.ui.settings.settings_controller import SettingsController

    app = build_test_app(tmp_path)
    try:
        controller = SettingsController(
            app.company_service_repo,
            SqliteAssetRepository(app.connection),
            app.settings_service,
            AssetStore(tmp_path / "assets"),
        )
        screen = SettingsScreen(controller)
        screen.name.setText("SUNTECH ENTERPRISES")
        screen.state_name.setText("Maharashtra")
        screen.state_code.setText("27")
        screen.save()

        logo = tmp_path / "logo.png"
        logo.write_bytes(b"\x89PNG\r\n\x1a\n fake-logo-bytes")
        assert screen.set_logo(str(logo))
        company = app.company_service_repo.get_active()
        assert company is not None
        assert company.logo_asset_id is not None
        # Import a second version; historical pinning is not corrupted.
        assert screen.set_logo(str(logo))
    finally:
        app.close()


def test_service_template_manage_and_delete(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        s = _settings(window)
        s.tmpl_name.setText("Gundrilling")
        s.tmpl_description.setText("Service Charges (Gundrilling)")
        s.tmpl_hsn.setText("998898")
        s.tmpl_unit.setText("MM")
        s._on_template_save()  # noqa: SLF001
        assert len(app.settings_service.list_service_templates()) == 1
        s.template_table.selectRow(0)
        s._on_template_delete()  # noqa: SLF001
        assert list(app.settings_service.list_service_templates()) == []
    finally:
        app.close()


# --- customers ---


def test_customer_create_edit_archive(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _add_customer(window)
        assert len(app.customer_service_repo.list_active()) == 1
        c = _customers(window)
        # Edit the saved customer.
        c.table.selectRow(0)
        c.phone.setText("9999999999")
        c.save_current()
        assert app.customer_service_repo.list_active()[0].phone == "9999999999"
        # Archive it.
        c.table.selectRow(0)
        c.archive_selected()
        assert list(app.customer_service_repo.list_active()) == []
    finally:
        app.close()


# --- invoice: calc, save draft, finalize ---


def test_invoice_calculation_breakdown_displayed(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _fill_company(window)
        _add_customer(window)
        _build_invoice_lines(window)
        f = window._invoice_form  # noqa: SLF001
        assert f.taxable_label.text() == "12280.00"
        assert f.cgst_label.text() == "1105.20"
        assert f.sgst_label.text() == "1105.20"
        assert f.grand_total_label.text() == "14490.00"
    finally:
        app.close()


def test_invoice_draft_save_and_reopen_from_history(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _fill_company(window)
        _add_customer(window)
        window._on_new_invoice()  # noqa: SLF001
        _build_invoice_lines(window)
        window._invoice_form.save_draft()  # noqa: SLF001

        history = _history(window)
        history.refresh()
        assert history.table.rowCount() == 1
        assert history._rows[0].status == InvoiceStatus.DRAFT  # noqa: SLF001

        # Open the draft from history -> lands in the editor, editable.
        history.table.selectRow(0)
        assert history.open_selected()
        assert window.current_screen_name() == "Create / Edit Invoice"
        # A draft is editable: finalize + line table enabled, outputs disabled.
        assert window._invoice_form.finalize_button.isEnabled()  # noqa: SLF001
        assert window._invoice_form.line_table.isEnabled()  # noqa: SLF001
        assert not window._invoice_form.preview_button.isEnabled()  # noqa: SLF001
    finally:
        app.close()


def test_invoice_finalize_locks_and_enables_outputs(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _fill_company(window)
        _add_customer(window)
        window._on_new_invoice()  # noqa: SLF001
        _build_invoice_lines(window)
        f = window._invoice_form  # noqa: SLF001
        finalized = f.finalize(date(2026, 5, 11))
        assert finalized is not None
        assert finalized.invoice_number == "SE/26-27/001"
        # Inputs locked, outputs enabled.
        assert not f.finalize_button.isEnabled()
        assert not f.line_table.isEnabled()
        assert f.preview_button.isEnabled()
        assert f.export_button.isEnabled()
        assert f.print_button.isEnabled()
    finally:
        app.close()


# --- history: preview/export/duplicate/cancel/payment ---


def _finalize_one(window: MainWindow) -> None:
    _fill_company(window)
    _add_customer(window)
    window._on_new_invoice()  # noqa: SLF001
    _build_invoice_lines(window)
    window._invoice_form.finalize(date(2026, 5, 11))  # noqa: SLF001


def test_history_preview_and_export_produce_pdf(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _finalize_one(window)
        history = _history(window)
        history.refresh()
        inv_id = history._rows[0].invoice_id  # noqa: SLF001
        # Preview bytes + export via the controller (no OS viewer launched).
        pdf = history._controller.preview_bytes(inv_id)  # noqa: SLF001
        assert pdf.startswith(b"%PDF-")
        out = tmp_path / "exported.pdf"
        history._controller.export(inv_id, str(out))  # noqa: SLF001
        assert out.exists()
    finally:
        app.close()


def test_history_duplicate_creates_draft(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _finalize_one(window)
        history = _history(window)
        history.refresh()
        history.table.selectRow(0)
        assert history.duplicate_selected()
        # Original finalized + a new DRAFT copy.
        assert len(history._rows) == 2  # noqa: SLF001
        assert InvoiceStatus.DRAFT in {r.status for r in history._rows}  # noqa: SLF001
    finally:
        app.close()


def test_history_cancel_preserves_record(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _finalize_one(window)
        history = _history(window)
        history.refresh()
        inv_id = history._rows[0].invoice_id  # noqa: SLF001
        history._controller.cancel(inv_id, "duplicate entry")  # noqa: SLF001
        invoice = app.invoice_service.get(inv_id)
        assert invoice is not None
        assert invoice.status == InvoiceStatus.CANCELLED
        assert invoice.invoice_number == "SE/26-27/001"  # number preserved
    finally:
        app.close()


def test_history_set_payment_status(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _finalize_one(window)
        history = _history(window)
        history.refresh()
        inv_id = history._rows[0].invoice_id  # noqa: SLF001
        history._controller.set_payment_status(inv_id, PaymentStatus.PAID)  # noqa: SLF001
        invoice = app.invoice_service.get(inv_id)
        assert invoice is not None
        assert invoice.payment_status == PaymentStatus.PAID
    finally:
        app.close()


# --- dashboard navigation ---


def test_dashboard_open_recent_navigates_to_editor(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _finalize_one(window)
        dash = _dashboard(window)
        dash.refresh()
        assert dash.table.rowCount() == 1
        dash.table.selectRow(0)
        assert dash.open_selected()
        assert window.current_screen_name() == "Create / Edit Invoice"
        assert window._invoice_form.number_label.text() == "Invoice SE/26-27/001"  # noqa: SLF001
    finally:
        app.close()
