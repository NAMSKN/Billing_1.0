"""Product group management dialog (product/service rules, section 9).

A small modal for creating, renaming and archiving product groups. Deletion is
never offered: a group referenced by a product is archived, never removed, so
product references are preserved. Presentation only; all logic goes through the
:class:`ProductController`.
"""

from __future__ import annotations

import uuid

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QInputDialog,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary
from product_service.application.errors import ProductServiceError
from product_service.ui.product_controller import ProductController


class ProductGroupDialog(QDialog):
    """Modal for managing product groups (create / rename / archive)."""

    def __init__(self, controller: ProductController, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._controller = controller
        self.setWindowTitle("Manage Product Groups")
        self.setMinimumSize(420, 380)

        self._list = QListWidget()
        self._new_name = QLineEdit()
        self._new_name.setPlaceholderText("New group name")
        self._add_button = make_primary(QPushButton("Add"))
        self._rename_button = QPushButton("Rename")
        self._archive_button = QPushButton("Archive")
        self.status = StatusBanner()
        self._buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)

        self._build_layout()
        self._wire()
        self._reload()

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        add_row = QHBoxLayout()
        add_row.addWidget(self._new_name, stretch=1)
        add_row.addWidget(self._add_button)
        layout.addLayout(add_row)
        layout.addWidget(self._list, stretch=1)
        actions = QHBoxLayout()
        actions.addWidget(self._rename_button)
        actions.addWidget(self._archive_button)
        actions.addStretch(1)
        layout.addLayout(actions)
        layout.addWidget(self.status)
        layout.addWidget(self._buttons)

    def _wire(self) -> None:
        self._add_button.clicked.connect(self._on_add)
        self._rename_button.clicked.connect(self._on_rename)
        self._archive_button.clicked.connect(self._on_archive)
        self._buttons.rejected.connect(self.reject)
        self._buttons.accepted.connect(self.accept)

    def _reload(self) -> None:
        self._list.clear()
        for group in self._controller.list_groups():
            item = QListWidgetItem(group.name)
            item.setData(Qt.ItemDataRole.UserRole, str(group.id))
            self._list.addItem(item)

    def _selected_id(self) -> uuid.UUID | None:
        item = self._list.currentItem()
        if item is None:
            return None
        return uuid.UUID(str(item.data(Qt.ItemDataRole.UserRole)))

    def _on_add(self) -> None:
        name = self._new_name.text().strip()
        if not name:
            self.status.show_error("Enter a group name.")
            return
        try:
            self._controller.create_group(name)
        except ProductServiceError as exc:
            self.status.show_error(str(exc))
            return
        self._new_name.clear()
        self._reload()
        self.status.show_ok(f"Added group '{name}'.")

    def _on_rename(self) -> None:
        group_id = self._selected_id()
        if group_id is None:
            self.status.show_info("Select a group first.")
            return
        current = self._list.currentItem()
        current_name = current.text() if current is not None else ""
        new_name, ok = QInputDialog.getText(
            self, "Rename Group", "New name:", QLineEdit.EchoMode.Normal, current_name
        )
        if not ok or not new_name.strip():
            return
        try:
            self._controller.rename_group(group_id, new_name.strip())
        except ProductServiceError as exc:
            self.status.show_error(str(exc))
            return
        self._reload()
        self.status.show_ok("Group renamed.")

    def _on_archive(self) -> None:
        group_id = self._selected_id()
        if group_id is None:
            self.status.show_info("Select a group first.")
            return
        confirm = QMessageBox.question(
            self,
            "Archive Group",
            "Archive this group? Products already in it keep the reference; the "
            "group is hidden from new selection.",
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        try:
            self._controller.archive_group(group_id)
        except ProductServiceError as exc:
            self.status.show_error(str(exc))
            return
        self._reload()
        self.status.show_ok("Group archived.")
