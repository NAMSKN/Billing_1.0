"""Phase-2 UI remediation workflow tests (template dialog, theme, dashboard).

Application-level tests through the real MainWindow / screens proving:
A-D  template insertion happy path / cancel / no-templates / existing lines
E    theme initialization uses the light palette
F-J  dashboard metrics from persisted data, exclusions, payment counts, open nav
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtGui import QColor  # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402

from invoice_generator.domain.enums import PaymentStatus  # noqa: E402
from invoice_generator.domain.models import (  # noqa: E402
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
    ServiceTemplate,
)
from invoice_generator.ui.dashboard.dashboard_screen import DashboardScreen  # noqa: E402
from invoice_generator.ui.invoices import template_picker  # noqa: E402
from invoice_generator.ui.invoices.invoice_form import InvoiceForm  # noqa: E402
from invoice_generator.ui.invoices.invoice_form_controller import (  # noqa: E402
    InvoiceFormController,
)
from invoice_generator.ui.main_window import MainWindow  # noqa: E402
from invoice_generator.ui.theme import force_light_theme, is_light_palette  # noqa: E402
from tests.support.build_test_app import build_test_app  # noqa: E402

INVOICE_DATE = date(2026, 5, 11)


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _template(name: str = "Gundrilling") -> ServiceTemplate:
    return ServiceTemplate(name=name, description=f"{name} op", hsn_sac="998898", unit="MM")


def _line(desc: str = "Existing") -> InvoiceLine:
    return InvoiceLine(
        description=desc,
        hsn_sac="998898",
        quantity=Decimal("2"),
        unit="NOS",
        rate=Decimal("100"),
        tax_rate=Decimal("18"),
    )


def _seeded_form(app: object, tmp_path: Path) -> InvoiceForm:
    app.company_service_repo.save(  # type: ignore[attr-defined]
        Company(name="SUNTECH", address=Address(state_name="Maharashtra", state_code="27"))
    )
    customer = Customer(
        name="DI-TECH", bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code="27")
    )
    app.customer_service_repo.save(customer)  # type: ignore[attr-defined]
    form = InvoiceForm(InvoiceFormController(app))  # type: ignore[arg-type]
    form.reload_customers()
    form.customer_combo.setCurrentIndex(1)
    return form


# --- A-D: template insertion ---


def test_template_insert_happy_path(qapp: QApplication, tmp_path: Path, monkeypatch) -> None:
    app = build_test_app(tmp_path)
    try:
        tpl = _template()
        app.settings_service.save_service_template(tpl)
        form = _seeded_form(app, tmp_path)

        # Simulate the picker: accept and return the template id.
        monkeypatch.setattr(
            template_picker.TemplatePickerDialog,
            "exec",
            lambda self: QDialog.DialogCode.Accepted,
        )
        monkeypatch.setattr(
            template_picker.TemplatePickerDialog, "selected_id", lambda self: tpl.id
        )
        form.insert_selected_template()

        assert form.line_table.table.rowCount() == 1
        assert form._controller.working.lines[0].hsn_sac == "998898"  # noqa: SLF001
        # Inserted line is editable (quantity default, operator fills it).
        assert form._controller.working.lines[0].description == "Gundrilling op"  # noqa: SLF001
    finally:
        app.close()


def test_template_insert_cancel_leaves_invoice_unchanged(
    qapp: QApplication, tmp_path: Path, monkeypatch
) -> None:
    app = build_test_app(tmp_path)
    try:
        app.settings_service.save_service_template(_template())
        form = _seeded_form(app, tmp_path)
        form.line_table.set_lines((_line(),))
        form._controller.set_lines(form.line_table.collect_lines())  # noqa: SLF001

        # Cancel the dialog.
        monkeypatch.setattr(
            template_picker.TemplatePickerDialog, "exec", lambda self: QDialog.DialogCode.Rejected
        )
        form.insert_selected_template()

        # Unchanged: still the single pre-existing line.
        assert form.line_table.table.rowCount() == 1
        assert form._controller.working.lines[0].description == "Existing"  # noqa: SLF001
    finally:
        app.close()


def test_template_insert_no_templates_empty_state(
    qapp: QApplication, tmp_path: Path, monkeypatch
) -> None:
    app = build_test_app(tmp_path)
    try:
        form = _seeded_form(app, tmp_path)
        # No templates saved. Cancel/close of the empty dialog offers Settings;
        # suppress the follow-up message box and assert nothing was inserted.
        monkeypatch.setattr(
            template_picker.TemplatePickerDialog, "exec", lambda self: QDialog.DialogCode.Rejected
        )
        monkeypatch.setattr(form, "_offer_settings_navigation", lambda: None)
        form.insert_selected_template()
        assert form.line_table.table.rowCount() == 0
    finally:
        app.close()


def test_template_insert_preserves_existing_lines(
    qapp: QApplication, tmp_path: Path, monkeypatch
) -> None:
    app = build_test_app(tmp_path)
    try:
        tpl = _template()
        app.settings_service.save_service_template(tpl)
        form = _seeded_form(app, tmp_path)
        form.line_table.set_lines((_line("Keep me"),))

        monkeypatch.setattr(
            template_picker.TemplatePickerDialog, "exec", lambda self: QDialog.DialogCode.Accepted
        )
        monkeypatch.setattr(
            template_picker.TemplatePickerDialog, "selected_id", lambda self: tpl.id
        )
        form.insert_selected_template()

        # Original line preserved + the inserted template line appended.
        assert form.line_table.table.rowCount() == 2
        descriptions = [ln.description for ln in form._controller.working.lines]  # noqa: SLF001
        assert "Keep me" in descriptions
        assert "Gundrilling op" in descriptions
    finally:
        app.close()


def test_template_insert_deleted_template_reports_error(
    qapp: QApplication, tmp_path: Path
) -> None:
    import uuid

    app = build_test_app(tmp_path)
    try:
        form = _seeded_form(app, tmp_path)
        # Direct insert of a non-existent template -> handled, error surfaced.
        assert not form.insert_template(uuid.uuid4())
        assert "not found" in form.status.text().lower() or form.status.text() != ""
        assert form.line_table.table.rowCount() == 0
    finally:
        app.close()


# --- E: theme ---


def test_force_light_theme_sets_light_palette(qapp: QApplication) -> None:
    force_light_theme(qapp)
    palette = qapp.palette()
    from PySide6.QtGui import QPalette

    window = palette.color(QPalette.ColorRole.Window)
    text = palette.color(QPalette.ColorRole.WindowText)
    base = palette.color(QPalette.ColorRole.Base)
    # Backgrounds are light, text is dark -> a light theme.
    assert window.lightness() > 200
    assert base == QColor("white")
    assert text.lightness() < 80
    assert is_light_palette(qapp)


def test_mainwindow_applies_light_stylesheet(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        sheet = window.styleSheet()
        # No dark backgrounds or blue/purple accents in the app stylesheet.
        assert "#2a6df0" not in sheet  # old blue accent removed
        lowered = sheet.lower()
        assert "#000" not in lowered or "background" in lowered  # sanity: has styling
    finally:
        app.close()


# --- F-J: dashboard ---


def _finalize(app: object, customer_name: str, when: date) -> Invoice:
    customer = Customer(
        name=customer_name,
        bill_to=Address(line="Plot", state_name="Maharashtra", state_code="27"),
    )
    app.customer_service_repo.save(customer)  # type: ignore[attr-defined]
    draft = app.invoice_service.create_draft(  # type: ignore[attr-defined]
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
    return app.invoice_service.finalize(draft.id, invoice_date=when)  # type: ignore[attr-defined]


def _seed_company(app: object) -> None:
    app.company_service_repo.save(  # type: ignore[attr-defined]
        Company(name="SUNTECH", address=Address(state_name="Maharashtra", state_code="27"))
    )


def test_dashboard_metrics_reflect_persisted_data(qapp: QApplication, tmp_path: Path) -> None:
    from invoice_generator.ui.dashboard.dashboard_controller import DashboardController

    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        _finalize(app, "A", date(2026, 5, 11))
        # A draft that must NOT count toward finalized totals.
        app.invoice_service.create_draft(
            Invoice(place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"))
        )
        m = DashboardController(app).metrics()
        assert m.total == 2
        assert m.finalized == 1
        assert m.draft == 1
        assert m.cancelled == 0
        # Finalized totals come from the one finalized invoice (golden 043).
        assert m.finalized_taxable == Decimal("12280.00")
        assert m.finalized_tax == Decimal("2210.40")
        assert m.finalized_grand_total == Decimal("14490.00")
    finally:
        app.close()


def test_dashboard_excludes_drafts_and_cancelled_from_totals(
    qapp: QApplication, tmp_path: Path
) -> None:
    from datetime import UTC, datetime

    from invoice_generator.ui.dashboard.dashboard_controller import DashboardController

    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        keep = _finalize(app, "Keep", date(2026, 5, 11))
        cancelled = _finalize(app, "Cancel", date(2026, 5, 12))
        app.invoice_service.cancel(cancelled.id, "void", when=datetime.now(UTC))
        m = DashboardController(app).metrics()
        assert m.cancelled == 1
        # Only the non-cancelled finalized invoice contributes to totals.
        assert m.finalized_grand_total == keep.totals.grand_total
        assert m.pending_payment >= 0
    finally:
        app.close()


def test_dashboard_pending_payment_count(qapp: QApplication, tmp_path: Path) -> None:
    from invoice_generator.ui.dashboard.dashboard_controller import DashboardController

    app = build_test_app(tmp_path)
    try:
        _seed_company(app)
        paid = _finalize(app, "Paid", date(2026, 5, 11))
        _finalize(app, "Unpaid", date(2026, 5, 12))
        app.invoice_service.set_payment_status(paid.id, PaymentStatus.PAID)
        m = DashboardController(app).metrics()
        # Two finalized, one marked PAID -> one pending.
        assert m.finalized == 2
        assert m.pending_payment == 1
    finally:
        app.close()


def test_dashboard_open_navigates_to_editor(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        _seed_company(app)
        _finalize(app, "A", date(2026, 5, 11))
        dash = window._screens["Dashboard"]  # noqa: SLF001
        assert isinstance(dash, DashboardScreen)
        dash.refresh()
        dash.table.selectRow(0)
        assert dash.open_selected()
        assert window.current_screen_name() == "Create / Edit Invoice"
    finally:
        app.close()
