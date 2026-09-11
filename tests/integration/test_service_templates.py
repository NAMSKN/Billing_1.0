"""Tests for reusable service templates (Task 59, Req 29, P2).

Covers persistence (UUID id), the settings-service API, and the invoice-form
controller/widget insert flow: inserting a template appends a new line that
stays freely editable and adds no inventory behavior.

References: requirements Req 29; DECISIONS D-021, D-023.
"""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.domain.models import ServiceTemplate  # noqa: E402
from invoice_generator.ui.invoices.invoice_form import InvoiceForm  # noqa: E402
from invoice_generator.ui.invoices.invoice_form_controller import (  # noqa: E402
    InvoiceFormController,
)
from tests.support.build_test_app import build_test_app  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _template(name: str = "Gundrilling") -> ServiceTemplate:
    return ServiceTemplate(
        name=name,
        description=f"{name} operation",
        hsn_sac="998898",
        unit="NOS",
    )


# --- persistence + service API ---


def test_save_and_list_round_trip(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        template = _template()
        app.settings_service.save_service_template(template)
        listed = app.settings_service.list_service_templates()
        assert len(listed) == 1
        assert listed[0].id == template.id  # UUID preserved (D-023)
        assert listed[0].name == "Gundrilling"
        assert listed[0].hsn_sac == "998898"
    finally:
        app.close()


def test_list_ordered_by_name(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        app.settings_service.save_service_template(_template("6 Side Machining"))
        app.settings_service.save_service_template(_template("Gundrilling"))
        names = [t.name for t in app.settings_service.list_service_templates()]
        assert names == ["6 Side Machining", "Gundrilling"]
    finally:
        app.close()


def test_list_empty_when_none(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        assert app.settings_service.list_service_templates() == []
    finally:
        app.close()


# --- controller insert ---


def test_insert_template_appends_line(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        template = _template()
        app.settings_service.save_service_template(template)
        controller = InvoiceFormController(app)
        controller.new_draft()

        line = controller.insert_service_template(template.id)

        assert len(controller.working.lines) == 1
        assert line.description == "Gundrilling operation"
        assert line.hsn_sac == "998898"
        assert line.unit == "NOS"
        # No inventory data pulled in: price/quantity stay at defaults (Req 29.3).
        assert line.rate == Decimal(0)
        assert line.quantity == Decimal(0)
    finally:
        app.close()


def test_inserted_line_remains_editable(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        template = _template()
        app.settings_service.save_service_template(template)
        controller = InvoiceFormController(app)
        controller.new_draft()
        controller.insert_service_template(template.id)

        # The operator edits the inserted line freely (Req 29.2).
        inserted = controller.working.lines[0]
        edited = inserted.model_copy(
            update={"quantity": Decimal("16"), "rate": Decimal("767.50"), "description": "Custom"}
        )
        controller.set_lines((edited,))

        result = controller.working.lines[0]
        assert result.quantity == Decimal("16")
        assert result.rate == Decimal("767.50")
        assert result.description == "Custom"
    finally:
        app.close()


def test_insert_unknown_template_raises(tmp_path: Path) -> None:
    import uuid

    app = build_test_app(tmp_path)
    try:
        controller = InvoiceFormController(app)
        controller.new_draft()
        with pytest.raises(ValueError, match="not found"):
            controller.insert_service_template(uuid.uuid4())
    finally:
        app.close()


# --- widget flow (offscreen) ---


def test_form_inserts_template_into_table(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        template = _template()
        app.settings_service.save_service_template(template)
        form = InvoiceForm(InvoiceFormController(app))
        form.reload_service_templates()

        # Insert via the direct (dialog-chosen) path.
        assert form.insert_template(template.id)

        assert form.line_table.table.rowCount() == 1
        assert len(form._controller.working.lines) == 1  # noqa: SLF001
    finally:
        app.close()


def test_form_insert_button_enabled_for_draft_even_without_templates(
    qapp: QApplication, tmp_path: Path
) -> None:
    # The button now stays enabled for drafts so the picker can show its
    # empty-state guidance to Settings; it is only disabled once finalized.
    app = build_test_app(tmp_path)
    try:
        form = InvoiceForm(InvoiceFormController(app))
        assert form.insert_template_button.isEnabled() is True
    finally:
        app.close()
