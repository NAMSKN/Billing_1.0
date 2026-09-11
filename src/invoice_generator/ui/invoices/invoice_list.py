"""Invoice history screen widget (Task 50).

Thin PySide6 table over :class:`InvoiceListController`: shows invoice summaries
with search (number/customer), a status filter, and row actions
(preview/export/print/duplicate/cancel). All work goes through the controller
(no SQL/calculations in the widget — DECISIONS D-021). Internal UUIDs are not
shown as a column (Req 30.7) but are kept per row for actions.

References: requirements Req 21; DECISIONS D-021.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.ui.invoices.invoice_list_controller import (
    InvoiceFilter,
    InvoiceListController,
    InvoiceRow,
)

_COLUMNS = ("Number", "Date", "Customer", "Job/Mould", "Total", "Status", "Payment")
_STATUS_CHOICES = ("All", *[s.value for s in InvoiceStatus])


class InvoiceListScreen(QWidget):
    def __init__(self, controller: InvoiceListController) -> None:
        super().__init__()
        self._controller = controller
        self._rows: list[InvoiceRow] = []

        self.number_search = QLineEdit()
        self.number_search.setPlaceholderText("Search invoice number")
        self.customer_search = QLineEdit()
        self.customer_search.setPlaceholderText("Search customer")
        self.status_filter = QComboBox()
        self.status_filter.addItems(list(_STATUS_CHOICES))

        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)

        self.refresh_button = QPushButton("Refresh")
        self.duplicate_button = QPushButton("Duplicate")
        self.number_search.textChanged.connect(self.refresh)
        self.customer_search.textChanged.connect(self.refresh)
        self.status_filter.currentIndexChanged.connect(self.refresh)
        self.refresh_button.clicked.connect(self.refresh)
        self.duplicate_button.clicked.connect(self.duplicate_selected)

        self._build_layout()
        self.refresh()

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        filters = QHBoxLayout()
        filters.addWidget(self.number_search)
        filters.addWidget(self.customer_search)
        filters.addWidget(self.status_filter)
        filters.addWidget(self.refresh_button)
        layout.addLayout(filters)
        layout.addWidget(self.table, stretch=1)
        actions = QHBoxLayout()
        actions.addWidget(self.duplicate_button)
        layout.addLayout(actions)

    def current_filter(self) -> InvoiceFilter:
        status_text = self.status_filter.currentText()
        status = None if status_text == "All" else InvoiceStatus(status_text)
        return InvoiceFilter(
            number_query=self.number_search.text().strip(),
            customer_query=self.customer_search.text().strip(),
            status=status,
        )

    def refresh(self) -> None:
        self._rows = list(self._controller.list_rows(self.current_filter()))
        self.table.setRowCount(len(self._rows))
        for row, item in enumerate(self._rows):
            values = (
                item.number,
                item.date,
                item.customer,
                item.job_or_mould,
                item.total,
                item.status,
                item.payment_status,
            )
            for col, value in enumerate(values):
                self.table.setItem(row, col, QTableWidgetItem(value))

    def selected_row(self) -> InvoiceRow | None:
        row = self.table.currentRow()
        if 0 <= row < len(self._rows):
            return self._rows[row]
        return None

    def duplicate_selected(self) -> bool:
        selected = self.selected_row()
        if selected is None:
            return False
        self._controller.duplicate(selected.invoice_id)
        self.refresh()
        return True


__all__ = ["InvoiceListScreen"]
