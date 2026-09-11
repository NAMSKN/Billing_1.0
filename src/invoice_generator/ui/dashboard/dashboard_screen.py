"""Dashboard screen widget (Task 51).

Thin PySide6 dashboard over :class:`DashboardController`: a New Invoice action,
per-status counts, a quick-search box, and a recent-invoices table. All data
comes from the controller (no SQL/calculations in the widget — DECISIONS
D-021). "New Invoice" emits :attr:`new_invoice_requested` so the host window can
navigate to the invoice form.

References: requirements Req 25.1; DECISIONS D-021.
"""

from __future__ import annotations

from collections.abc import Sequence

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.dashboard.dashboard_controller import DashboardController
from invoice_generator.ui.invoices.invoice_list_controller import InvoiceRow

_COLUMNS = ("Number", "Date", "Customer", "Total", "Status")


class DashboardScreen(QWidget):
    new_invoice_requested = Signal()

    def __init__(self, controller: DashboardController) -> None:
        super().__init__()
        self._controller = controller
        self._rows: list[InvoiceRow] = []

        self.new_invoice_button = QPushButton("New Invoice")
        self.new_invoice_button.clicked.connect(self.new_invoice_requested.emit)

        self.counts_label = QLabel()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Quick search (number or customer)")

        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)

        self.search.textChanged.connect(self._on_search)

        self._build_layout()
        self.refresh()

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        top = QHBoxLayout()
        top.addWidget(self.new_invoice_button)
        top.addWidget(self.counts_label, stretch=1)
        layout.addLayout(top)
        layout.addWidget(self.search)
        layout.addWidget(QLabel("Recent invoices"))
        layout.addWidget(self.table, stretch=1)

    def refresh(self) -> None:
        """Reload counts and the recent-invoices table."""
        counts = self._controller.counts()
        self.counts_label.setText(
            f"Total: {counts.total}   Draft: {counts.draft}   "
            f"Finalized: {counts.finalized}   Cancelled: {counts.cancelled}"
        )
        self._show(self._controller.recent_invoices())

    def _on_search(self, text: str) -> None:
        self._show(self._controller.quick_search(text))

    def _show(self, rows: Sequence[InvoiceRow]) -> None:
        self._rows = list(rows)
        self.table.setRowCount(len(self._rows))
        for row, item in enumerate(self._rows):
            values = (item.number, item.date, item.customer, item.total, item.status)
            for col, value in enumerate(values):
                self.table.setItem(row, col, QTableWidgetItem(value))


__all__ = ["DashboardScreen"]
