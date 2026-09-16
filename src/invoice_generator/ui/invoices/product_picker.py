"""Product / Service selection dialog for the invoice form (V2 Feature 2).

An explicit modal for choosing a product, service, or additional-charges item
to insert as a new invoice line. Only active, sellable items are offered
(archived and non-sellable products are excluded upstream by the controller).
When no items exist, an informative empty state points the operator to the
Product Master screen.

Presentation only: the dialog returns the chosen product id (or ``None``); the
caller performs the insert through the controller, which pre-fills an editable
line from the product's defaults.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from product_service.domain.models import Product


class ProductPickerDialog(QDialog):
    """Modal picker returning the selected product id via :meth:`selected_id`."""

    def __init__(self, products: Sequence[Product], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Insert Product / Service")
        self.setMinimumWidth(460)
        self._products = list(products)
        self._selected_id: uuid.UUID | None = None

        layout = QVBoxLayout(self)

        if not self._products:
            message = QLabel(
                "No sellable products yet.\n\n"
                "Create them in Products / Services, then insert one here to "
                "pre-fill an invoice line."
            )
            message.setWordWrap(True)
            layout.addWidget(message)
            self.search = QLineEdit()
            self.search.setVisible(False)
            self.list = QListWidget()
            self.list.setVisible(False)
        else:
            layout.addWidget(QLabel("Select an item to insert as a new invoice line:"))
            self.search = QLineEdit()
            self.search.setPlaceholderText("Filter by name, HSN/SAC, or type")
            layout.addWidget(self.search)
            self.list = QListWidget()
            self._populate(self._products)
            self.list.setCurrentRow(0)
            self.list.itemDoubleClicked.connect(lambda _i: self.accept())
            self.search.textChanged.connect(self._on_filter)
            layout.addWidget(self.list)

        self.buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)
        ok_button = self.buttons.button(QDialogButtonBox.StandardButton.Ok)
        if ok_button is not None:
            ok_button.setEnabled(bool(self._products))
        layout.addWidget(self.buttons)

    def _populate(self, products: Sequence[Product]) -> None:
        self.list.clear()
        for product in products:
            detail = product.hsn_sac_code or product.item_type.label
            label = f"{product.name}  \u2014  {detail}" if detail else product.name
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, str(product.id))
            item.setToolTip(
                f"{product.name}\nType: {product.item_type.label}\n"
                f"HSN/SAC: {product.hsn_sac_code}\nUnit: {product.unit_of_measurement}\n"
                f"Sell Price: \u20b9{product.sell_price}"
            )
            self.list.addItem(item)

    def _on_filter(self, text: str) -> None:
        needle = text.strip().lower()
        if not needle:
            self._populate(self._products)
            return
        filtered = [
            p
            for p in self._products
            if needle in p.name.lower()
            or needle in p.hsn_sac_code.lower()
            or needle in p.item_type.label.lower()
        ]
        self._populate(filtered)

    def accept(self) -> None:
        item = self.list.currentItem() if self._products else None
        if item is not None:
            raw = item.data(Qt.ItemDataRole.UserRole)
            self._selected_id = uuid.UUID(str(raw))
        super().accept()

    def selected_id(self) -> uuid.UUID | None:
        """Return the chosen product id, or ``None`` if cancelled/empty."""
        return self._selected_id


__all__ = ["ProductPickerDialog"]
