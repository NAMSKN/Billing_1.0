"""Tests for the customer controller and screen (Task 47)."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.domain.models import Address, Customer  # noqa: E402
from invoice_generator.ui.customers.customer_controller import CustomerController  # noqa: E402
from invoice_generator.ui.customers.customer_screen import CustomerScreen  # noqa: E402
from tests.support.fakes import InMemoryCustomerRepository  # noqa: E402

VALID_GSTIN = "27ABCDE1234F1Z5"


def _controller() -> CustomerController:
    return CustomerController(InMemoryCustomerRepository())


def _customer(name: str = "BMSS Steel") -> Customer:
    return Customer(
        name=name,
        gstin=VALID_GSTIN,
        bill_to=Address(line="12 Rd", state_name="Maharashtra", state_code="27"),
    )


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


# --- controller ---


def test_save_and_list() -> None:
    ctrl = _controller()
    result = ctrl.save(_customer())
    assert result.is_ok
    names = [c.name for c in ctrl.list_customers()]
    assert "BMSS Steel" in names


def test_missing_name_blocks_save() -> None:
    ctrl = _controller()
    result = ctrl.save(Customer(name=""))
    assert not result.is_ok
    assert any(i.field == "customer.name" for i in result.blocking)
    assert list(ctrl.list_customers()) == []


def test_invalid_gstin_blocks_save() -> None:
    ctrl = _controller()
    result = ctrl.save(_customer().model_copy(update={"gstin": "BAD"}))
    assert not result.is_ok
    assert any(i.field == "customer.gstin" for i in result.blocking)


def test_edit_customer() -> None:
    ctrl = _controller()
    customer = _customer()
    ctrl.save(customer)
    ctrl.save(customer.model_copy(update={"name": "BMSS Renamed"}))
    listed = list(ctrl.list_customers())
    assert len(listed) == 1  # same id -> updated, not duplicated
    assert listed[0].name == "BMSS Renamed"


def test_archive_hides_from_selection() -> None:
    ctrl = _controller()
    customer = _customer()
    ctrl.save(customer)
    assert customer.name in [c.name for c in ctrl.customers_for_selection()]
    archived = ctrl.archive(customer.id)
    assert archived is not None and archived.is_active is False
    # Archived customer no longer offered for new invoices, and keeps its UUID.
    assert customer.name not in [c.name for c in ctrl.customers_for_selection()]
    assert archived.id == customer.id


def test_archive_missing_returns_none() -> None:
    import uuid

    ctrl = _controller()
    assert ctrl.archive(uuid.uuid4()) is None


# --- widget (offscreen) ---


def test_screen_lists_active_customers(qapp: QApplication) -> None:
    ctrl = _controller()
    ctrl.save(_customer("Alpha"))
    ctrl.save(_customer("Beta"))
    screen = CustomerScreen(ctrl)
    assert screen.table.rowCount() == 2


def test_screen_no_uuid_column(qapp: QApplication) -> None:
    ctrl = _controller()
    screen = CustomerScreen(ctrl)
    headers = [
        screen.table.horizontalHeaderItem(i).text() for i in range(screen.table.columnCount())
    ]
    assert headers == ["Name", "GSTIN", "State", "Phone", "Email"]
    assert not any("id" in h.lower() or "uuid" in h.lower() for h in headers)


def test_screen_save_new_customer(qapp: QApplication) -> None:
    ctrl = _controller()
    screen = CustomerScreen(ctrl)
    screen.new_customer()
    screen.name.setText("DI-TECH MOULDS")
    screen.gstin.setText(VALID_GSTIN)
    screen.bill_line.setText("Plot 9")
    result = screen.save_current()
    assert result.is_ok
    assert screen.table.rowCount() == 1
    assert "DI-TECH MOULDS" in [c.name for c in ctrl.list_customers()]


def test_screen_archive_selected(qapp: QApplication) -> None:
    ctrl = _controller()
    ctrl.save(_customer("ToArchive"))
    screen = CustomerScreen(ctrl)
    screen.table.selectRow(0)
    assert screen.archive_selected() is True
    assert screen.table.rowCount() == 0  # archived removed from active list


def test_screen_invalid_save_returns_blocking(qapp: QApplication) -> None:
    ctrl = _controller()
    screen = CustomerScreen(ctrl)
    screen.new_customer()
    screen.name.setText("")  # missing name
    result = screen.save_current()
    assert not result.is_ok
