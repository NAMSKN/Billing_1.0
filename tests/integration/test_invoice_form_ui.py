"""Tests for the create/edit invoice form controller and widget (Task 48)."""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.bootstrap import Application  # noqa: E402
from invoice_generator.domain.enums import InvoiceStatus  # noqa: E402
from invoice_generator.domain.models import (  # noqa: E402
    Address,
    Company,
    Customer,
    InvoiceLine,
)
from invoice_generator.ui.invoices.invoice_form import InvoiceForm  # noqa: E402
from invoice_generator.ui.invoices.invoice_form_controller import (  # noqa: E402
    InvoiceFormController,
)
from tests.support.build_test_app import build_test_app  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _seed(app: Application, *, customer_state: str = "27") -> Customer:
    company = Company(
        name="Suntech", address=Address(state_name="Maharashtra", state_code="27")
    )
    customer = Customer(
        name="DI-TECH MOULDS",
        bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code=customer_state),
    )
    app.company_service_repo.save(company)
    app.customer_service_repo.save(customer)
    return customer


def _line(rate: str = "767.50", qty: str = "16") -> InvoiceLine:
    return InvoiceLine(
        description="Gundrilling",
        hsn_sac="998898",
        quantity=Decimal(qty),
        unit="NOS",
        rate=Decimal(rate),
    )


# --- controller ---


def test_select_customer_defaults_place_of_supply(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)
        ctrl = InvoiceFormController(app)
        working = ctrl.select_customer(customer.id)
        assert working.customer_id == customer.id
        assert working.place_of_supply.state_code == "27"
    finally:
        app.close()


def test_live_totals_via_engine_intra_state(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)  # customer state 27 == company state 27 -> intra
        ctrl = InvoiceFormController(app)
        ctrl.select_customer(customer.id)
        ctrl.set_lines((_line(),))  # 16 x 767.50 = 12,280.00 @ 18%
        totals = ctrl.preview_totals()
        assert totals.total_taxable == Decimal("12280.00")
        assert totals.total_cgst == Decimal("1105.20")
        assert totals.total_sgst == Decimal("1105.20")
        assert totals.grand_total == Decimal("14490.00")
    finally:
        app.close()


def test_place_of_supply_override_switches_to_inter_state(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)
        ctrl = InvoiceFormController(app)
        ctrl.select_customer(customer.id)
        ctrl.set_lines((_line(),))
        # Override PoS to a different state -> inter-state (IGST).
        ctrl.set_place_of_supply("Gujarat", "24")
        totals = ctrl.preview_totals()
        assert totals.total_igst == Decimal("2210.40")
        assert totals.total_cgst == Decimal("0.00")
        assert totals.grand_total == Decimal("14490.00")
    finally:
        app.close()


def test_preview_totals_zero_without_lines(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed(app)
        ctrl = InvoiceFormController(app)
        assert ctrl.preview_totals().grand_total == Decimal("0.00")
    finally:
        app.close()


def test_save_draft_permissive(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)
        ctrl = InvoiceFormController(app)
        ctrl.select_customer(customer.id)
        ctrl.set_lines((_line(),))
        result = ctrl.save_draft()  # incomplete is allowed for a draft
        assert result.is_ok
        assert ctrl.working.status is InvoiceStatus.DRAFT
        assert ctrl.working.invoice_number is None
    finally:
        app.close()


def test_finalize_strict(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)
        ctrl = InvoiceFormController(app)
        ctrl.select_customer(customer.id)
        ctrl.set_lines((_line(),))
        finalized = ctrl.finalize(date(2026, 5, 11))
        assert finalized.status is InvoiceStatus.FINALIZED
        assert finalized.invoice_number == "SE/26-27/001"
        assert finalized.totals is not None
        assert finalized.totals.grand_total == Decimal("14490.00")
    finally:
        app.close()


def test_finalize_blocks_without_place_of_supply(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        customer = _seed(app)
        ctrl = InvoiceFormController(app)
        ctrl.select_customer(customer.id)
        ctrl.set_lines((_line(),))
        ctrl.set_place_of_supply("", "")  # clear PoS -> finalize must block
        result = ctrl.check_finalization(date(2026, 5, 11))
        assert not result.is_ok
    finally:
        app.close()


# --- widget (offscreen) ---


def test_form_customer_selection_populates_pos(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed(app)
        form = InvoiceForm(InvoiceFormController(app))
        form.customer_combo.setCurrentIndex(1)  # first real customer
        assert form.pos_code.text() == "27"
    finally:
        app.close()


def test_form_live_totals_update(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed(app)
        form = InvoiceForm(InvoiceFormController(app))
        form.customer_combo.setCurrentIndex(1)
        form.line_table.set_lines((_line(),))
        form.refresh_totals()
        assert "14490.00" in form.totals_label.text()
    finally:
        app.close()


def test_form_save_draft(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        _seed(app)
        form = InvoiceForm(InvoiceFormController(app))
        form.customer_combo.setCurrentIndex(1)
        form.line_table.set_lines((_line(),))
        result = form.save_draft()
        assert result.is_ok
    finally:
        app.close()
