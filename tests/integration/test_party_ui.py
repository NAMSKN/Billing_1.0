"""Offscreen UI tests for the party editor and list screen."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from datetime import UTC

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.infrastructure.db.connection import connect  # noqa: E402
from invoice_generator.infrastructure.db.migrator import apply_pending  # noqa: E402
from tests.support.id_factory import SequentialIdGenerator  # noqa: E402
from vendor_customer.application.party_group_service import PartyGroupService  # noqa: E402
from vendor_customer.application.party_service import PartyService  # noqa: E402
from vendor_customer.domain.models import INDIA, PartyType  # noqa: E402
from vendor_customer.infrastructure.db.sqlite_party_group_repository import (  # noqa: E402
    SqlitePartyGroupRepository,
)
from vendor_customer.infrastructure.db.sqlite_party_repository import (  # noqa: E402
    SqlitePartyRepository,
)
from vendor_customer.ui.party_controller import PartyController  # noqa: E402
from vendor_customer.ui.party_editor_dialog import PartyEditorDialog  # noqa: E402
from vendor_customer.ui.party_list_screen import PartyListScreen  # noqa: E402


class _Clock:
    def now(self):  # type: ignore[no-untyped-def]
        from datetime import datetime

        return datetime(2026, 9, 11, tzinfo=UTC)


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _controller() -> PartyController:
    conn = connect(":memory:")
    apply_pending(conn)
    party_svc = PartyService(
        SqlitePartyRepository(conn), id_generator=SequentialIdGenerator(1), clock=_Clock()
    )
    group_svc = PartyGroupService(
        SqlitePartyGroupRepository(conn), id_generator=SequentialIdGenerator(500)
    )
    return PartyController(party_svc, group_svc)


def test_editor_country_defaults_to_india(qapp: QApplication) -> None:
    dialog = PartyEditorDialog(_controller())
    assert dialog.bill_country.currentText() == INDIA


def test_editor_state_is_a_dropdown_not_free_text(qapp: QApplication) -> None:
    dialog = PartyEditorDialog(_controller())
    # A combo box with the state master loaded (not a free-text field).
    assert dialog.bill_state.count() > 30
    assert dialog.bill_state.itemText(1) != ""


def test_editor_saves_customer_with_document_visibility(qapp: QApplication) -> None:
    controller = _controller()
    dialog = PartyEditorDialog(controller)
    dialog.company_name.setText("UI Cust")
    dialog.company_type.setCurrentIndex(0)  # Customer
    dialog.bill_city.setText("Pune")
    # Select Maharashtra (state code 27) from the dropdown.
    idx = dialog.bill_state.findData("27")
    dialog.bill_state.setCurrentIndex(idx)
    dialog.visible_on_documents.setChecked(True)
    dialog._on_save()  # triggers create
    assert dialog.saved_id is not None

    saved = controller.get_party(dialog.saved_id)
    assert saved is not None
    assert saved.company_name == "UI Cust"
    assert saved.billing_address.state == "Maharashtra"
    assert saved.billing_address.state_code == "27"
    assert saved.visible_on_documents is True


def test_editor_missing_state_blocks_save(qapp: QApplication) -> None:
    controller = _controller()
    dialog = PartyEditorDialog(controller)
    dialog.company_name.setText("No State Co")
    dialog.bill_city.setText("Pune")
    # Leave state unselected.
    dialog._on_save()
    assert dialog.saved_id is None  # not saved
    assert "State is required" in dialog.status.text()


def test_list_screen_tabs_and_reload(qapp: QApplication) -> None:
    controller = _controller()
    from vendor_customer.application.dto import PartyInput
    from vendor_customer.domain.models import PartyAddress

    def _india(name: str, ptype: PartyType) -> PartyInput:
        return PartyInput(
            company_name=name,
            company_type=ptype,
            billing_address=PartyAddress(state="Maharashtra", state_code="27", city="Pune"),
        )

    controller.create_party(_india("CustOnly", PartyType.CUSTOMER))
    controller.create_party(_india("VendOnly", PartyType.VENDOR))
    controller.create_party(_india("BothInc", PartyType.CUSTOMER_VENDOR))

    screen = PartyListScreen(controller)
    assert screen.table.rowCount() == 3  # All
    screen.tabs.setCurrentIndex(1)  # Customers
    assert screen.table.rowCount() == 2  # CustOnly + BothInc
    screen.tabs.setCurrentIndex(2)  # Vendors
    assert screen.table.rowCount() == 2  # VendOnly + BothInc
