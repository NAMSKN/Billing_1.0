"""Customer / Vendor Master list screen (product rules, section 14).

A table of parties with role tabs (All / Customers / Vendors), a search box
(name, contact person, phone, GSTIN), an active/archived filter, and Open / Edit
/ Archive actions plus Add, Import Excel and Export Excel. The widget performs no
SQL and no business rules (DECISIONS D-021); everything goes through
:class:`PartyController`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from decimal import Decimal

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import (
    StatusBanner,
    make_danger,
    make_primary,
    title_label,
)
from vendor_customer.domain.models import BalanceType, Party, PartyType
from vendor_customer.ui.excel_dialogs import (
    ExportScopeDialog,
    ImportModeDialog,
    ImportPreviewDialog,
)
from vendor_customer.ui.party_controller import PartyController
from vendor_customer.ui.party_editor_dialog import PartyEditorDialog

_COLUMNS = (
    "Name",
    "Contact Person",
    "Contact No",
    "GSTIN",
    "State",
    "City",
    "Company Type",
    "Balance",
    "Status",
)

_TABS = ("All", "Customers", "Vendors")


class PartyListScreen(QWidget):
    """Screen for browsing and managing customers / vendors."""

    def __init__(self, controller: PartyController) -> None:
        super().__init__()
        self._controller = controller
        self._rows: list[Party] = []

        self._build_widgets()
        self._build_layout()
        self._wire()
        self.reload()

    def _build_widgets(self) -> None:
        self.tabs = QComboBox()
        self.tabs.addItems(list(_TABS))

        self.search = QLineEdit()
        self.search.setPlaceholderText("Search name, contact person, phone, or GSTIN")

        self.show_archived = QCheckBox("Show archived")

        self.add_button = make_primary(QPushButton("+ Add Customer / Vendor"))
        self.import_button = QPushButton("Import Excel")
        self.export_button = QPushButton("Export Excel")

        self.open_button = QPushButton("Open")
        self.edit_button = QPushButton("Edit")
        self.archive_button = make_danger(QPushButton("Archive"))

        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)

        self.status = StatusBanner()

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Customer / Vendor Master"))

        toolbar = QHBoxLayout()
        toolbar.addWidget(self.tabs)
        toolbar.addWidget(self.search, stretch=1)
        toolbar.addWidget(self.show_archived)
        toolbar.addWidget(self.add_button)
        toolbar.addWidget(self.import_button)
        toolbar.addWidget(self.export_button)
        layout.addLayout(toolbar)

        layout.addWidget(self.table, stretch=1)

        actions = QHBoxLayout()
        actions.addWidget(self.open_button)
        actions.addWidget(self.edit_button)
        actions.addWidget(self.archive_button)
        actions.addStretch(1)
        layout.addLayout(actions)

        layout.addWidget(self.status)

    def _wire(self) -> None:
        self.tabs.currentIndexChanged.connect(self.reload)
        self.search.textChanged.connect(self.reload)
        self.show_archived.toggled.connect(self.reload)
        self.add_button.clicked.connect(self._on_add)
        self.import_button.clicked.connect(self._on_import)
        self.export_button.clicked.connect(self._on_export)
        self.open_button.clicked.connect(lambda: self._open_selected(edit=False))
        self.edit_button.clicked.connect(lambda: self._open_selected(edit=True))
        self.archive_button.clicked.connect(self._on_archive)
        self.table.doubleClicked.connect(lambda _idx: self._open_selected(edit=True))

    # --- data ---

    def _current_type(self) -> PartyType | None:
        return {0: None, 1: PartyType.CUSTOMER, 2: PartyType.VENDOR}[self.tabs.currentIndex()]

    def reload(self) -> None:
        term = self.search.text().strip()
        party_type = self._current_type()
        include_archived = self.show_archived.isChecked()
        if term:
            self._rows = list(
                self._controller.search_parties(
                    term, party_type=party_type, include_archived=include_archived
                )
            )
        else:
            self._rows = list(
                self._controller.list_parties(
                    party_type=party_type, include_archived=include_archived
                )
            )
        self._fill_table(self._rows)
        if not self._rows:
            self.status.show_info("No matching customers / vendors.")
        else:
            self.status.show_info(f"{len(self._rows)} record(s).")

    def _fill_table(self, parties: Sequence[Party]) -> None:
        self.table.setRowCount(len(parties))
        for row_idx, p in enumerate(parties):
            values = (
                p.company_name,
                p.contact_person,
                p.contact_no,
                p.gstin,
                p.billing_address.state,
                p.billing_address.city,
                p.company_type.label,
                _balance_summary(p),
                "Active" if p.is_active else "Archived",
            )
            for col, value in enumerate(values):
                item = QTableWidgetItem(value or "\u2014")
                item.setToolTip(value or "")
                if col == 0:
                    item.setData(Qt.ItemDataRole.UserRole, str(p.id))
                self.table.setItem(row_idx, col, item)

    def _selected_party(self) -> Party | None:
        row = self.table.currentRow()
        if 0 <= row < len(self._rows):
            return self._rows[row]
        return None

    # --- actions ---

    def _on_add(self) -> None:
        dialog = PartyEditorDialog(self._controller, party=None, parent=self)
        if dialog.exec() == int(QMessageBox.DialogCode.Accepted):
            self.reload()
            self.status.show_ok("Customer / Vendor saved.")

    def _open_selected(self, *, edit: bool) -> None:
        party = self._selected_party()
        if party is None:
            self.status.show_info("Select a record first.")
            return
        # Open and Edit use the same editor; the editor is always editable here.
        dialog = PartyEditorDialog(self._controller, party=party, parent=self)
        if dialog.exec() == int(QMessageBox.DialogCode.Accepted):
            self.reload()
            self.status.show_ok("Customer / Vendor updated.")

    def _on_archive(self) -> None:
        party = self._selected_party()
        if party is None:
            self.status.show_info("Select a record first.")
            return
        confirm = QMessageBox.question(
            self,
            "Archive",
            f"Archive '{party.company_name}'? It will be hidden from new documents "
            "but kept for historical records.",
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        self._controller.archive_party(party.id)
        self.reload()
        self.status.show_ok(f"Archived '{party.company_name}'.")

    def _on_export(self) -> None:
        scope_dialog = ExportScopeDialog(self)
        if scope_dialog.exec() != int(QMessageBox.DialogCode.Accepted):
            return
        scope = scope_dialog.selected_scope()
        path, _ = QFileDialog.getSaveFileName(
            self, "Export to Excel", scope_dialog.suggested_filename(), "Excel (*.xlsx)"
        )
        if not path:
            return
        try:
            # QFileDialog already prompts before overwriting an existing file,
            # so allow overwrite when the user has confirmed a path.
            written = self._controller.export(
                scope, path, include_archived=self.show_archived.isChecked(), overwrite=True
            )
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Export failed: {exc}")
            return
        self.status.show_ok(f"Exported to {written}")

    def _on_import(self) -> None:
        mode_dialog = ImportModeDialog(self)
        if mode_dialog.exec() != int(QMessageBox.DialogCode.Accepted):
            return
        import_as = mode_dialog.selected_mode()
        path, _ = QFileDialog.getOpenFileName(self, "Import from Excel", "", "Excel (*.xlsx)")
        if not path:
            return
        try:
            preview = self._controller.build_import_preview(path, import_as=import_as)
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Could not read file: {exc}")
            return

        preview_dialog = ImportPreviewDialog(preview, self)
        if preview_dialog.exec() != int(QMessageBox.DialogCode.Accepted):
            self.status.show_info("Import cancelled. No data was changed.")
            return
        try:
            result = self._controller.commit_import(preview)
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Import failed: {exc}")
            return
        self.reload()
        self.status.show_ok(
            f"Imported: {result.created} created, {result.updated} updated, "
            f"{result.skipped} skipped."
        )

    def selected_id(self) -> uuid.UUID | None:
        party = self._selected_party()
        return party.id if party is not None else None


def _balance_summary(party: Party) -> str:
    parts: list[str] = []
    cb = party.customer_balance
    vb = party.vendor_balance
    if party.company_type.is_customer and cb.amount != Decimal("0"):
        parts.append(f"C: {_signed(cb.balance_type, cb.amount)}")
    if party.company_type.is_vendor and vb.amount != Decimal("0"):
        parts.append(f"V: {_signed(vb.balance_type, vb.amount)}")
    return "  ".join(parts)


def _signed(balance_type: BalanceType, amount: Decimal) -> str:
    suffix = "Dr" if balance_type is BalanceType.DEBIT else "Cr"
    return f"\u20b9{amount} {suffix}"
