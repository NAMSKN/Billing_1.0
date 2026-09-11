"""Service-template selection dialog (UI remediation phase 2).

An explicit modal dialog for choosing a service template to insert into the
invoice. Replaces the previous silent dropdown so the interaction is obvious:
the operator sees the available templates, picks one, and confirms — or cancels,
leaving the invoice unchanged. When no templates exist, an informative empty
state points the operator to Settings -> Service Templates.

Presentation only: the dialog returns the chosen template id (or ``None``); the
caller performs the insert through the controller.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.models import ServiceTemplate


class TemplatePickerDialog(QDialog):
    """Modal picker returning the selected template id via :meth:`selected_id`."""

    def __init__(self, templates: Sequence[ServiceTemplate], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Insert Service Template")
        self.setMinimumWidth(420)
        self._templates = list(templates)
        self._selected_id: uuid.UUID | None = None

        layout = QVBoxLayout(self)

        if not self._templates:
            # Empty state: clear guidance + a disabled OK so nothing is inserted.
            message = QLabel(
                "No service templates yet.\n\n"
                "Create them in Settings \u2192 Service Templates, then insert "
                "one here to pre-fill an invoice line."
            )
            message.setWordWrap(True)
            layout.addWidget(message)
            self.list = QListWidget()
            self.list.setVisible(False)
        else:
            layout.addWidget(QLabel("Select a template to insert as a new invoice line:"))
            self.list = QListWidget()
            for template in self._templates:
                label = template.name
                detail = template.description or template.hsn_sac
                if detail and detail != template.name:
                    label = f"{template.name}  \u2014  {detail}"
                item = QListWidgetItem(label)
                item.setData(Qt.ItemDataRole.UserRole, str(template.id))
                item.setToolTip(
                    f"{template.name}\nHSN/SAC: {template.hsn_sac}\nUnit: {template.unit}"
                )
                self.list.addItem(item)
            self.list.setCurrentRow(0)
            self.list.itemDoubleClicked.connect(lambda _i: self.accept())
            layout.addWidget(self.list)

        self.buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)
        # With no templates there is nothing to insert; disable OK.
        ok_button = self.buttons.button(QDialogButtonBox.StandardButton.Ok)
        if ok_button is not None:
            ok_button.setEnabled(bool(self._templates))
        layout.addWidget(self.buttons)

    def accept(self) -> None:
        item = self.list.currentItem() if self._templates else None
        if item is not None:
            raw = item.data(Qt.ItemDataRole.UserRole)
            self._selected_id = uuid.UUID(str(raw))
        super().accept()

    def selected_id(self) -> uuid.UUID | None:
        """Return the chosen template id, or ``None`` if cancelled/empty."""
        return self._selected_id


__all__ = ["TemplatePickerDialog"]
