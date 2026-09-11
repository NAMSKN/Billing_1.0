"""Invoice history screen widget (Task 50 + UI remediation).

Thin PySide6 table over :class:`InvoiceListController`: invoice summaries with
search (number/customer), a status filter, and row actions. All work goes
through the controller (no SQL/calculations in the widget — DECISIONS D-021).

Remediation: cells carry full-text tooltips and columns stretch so critical
information is never permanently hidden behind an ellipsis; an Open action (and
double-click) loads the selected invoice into the editor via the navigator —
a DRAFT opens for editing, a finalized invoice opens read-only; Preview/Export/
Print/Duplicate/Cancel are available where the lifecycle allows.

References: requirements Req 21; DECISIONS D-021.
"""

from __future__ import annotations

import tempfile
from datetime import UTC, datetime
from pathlib import Path

from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QHeaderView,
    QInputDialog,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
from invoice_generator.ui.common.errors import show_error_dialog
from invoice_generator.ui.common.navigation import Navigator
from invoice_generator.ui.common.ui_kit import (
    StatusBanner,
    horizontal_bar,
    make_primary,
    title_label,
)
from invoice_generator.ui.invoices.invoice_list_controller import (
    InvoiceFilter,
    InvoiceListController,
    InvoiceRow,
)

_COLUMNS = ("Number", "Date", "Customer", "Job/Mould", "Total", "Status", "Payment")
_STATUS_CHOICES = ("All", *[s.value for s in InvoiceStatus])


class InvoiceListScreen(QWidget):
    def __init__(
        self,
        controller: InvoiceListController,
        navigator: Navigator | None = None,
    ) -> None:
        super().__init__()
        self._controller = controller
        self._navigator = navigator
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
        self.table.setWordWrap(True)
        self.table.itemDoubleClicked.connect(lambda _i: self.open_selected())
        self.table.itemSelectionChanged.connect(self._sync_actions)
        self._configure_columns()

        self.open_button = make_primary(QPushButton("Open"))
        self.preview_button = QPushButton("Preview")
        self.export_button = QPushButton("Export PDF")
        self.print_button = QPushButton("Print")
        self.duplicate_button = QPushButton("Duplicate")
        self.cancel_button = QPushButton("Cancel")
        self.payment_combo = QComboBox()
        self.payment_combo.addItems([s.value for s in PaymentStatus])
        self.set_payment_button = QPushButton("Set Payment")
        self.refresh_button = QPushButton("Refresh")
        self.status = StatusBanner()

        self.number_search.textChanged.connect(self.refresh)
        self.customer_search.textChanged.connect(self.refresh)
        self.status_filter.currentIndexChanged.connect(self.refresh)
        self.refresh_button.clicked.connect(self.refresh)
        self.open_button.clicked.connect(self.open_selected)
        self.preview_button.clicked.connect(self._on_preview)
        self.export_button.clicked.connect(self._on_export)
        self.print_button.clicked.connect(self._on_print)
        self.duplicate_button.clicked.connect(self.duplicate_selected)
        self.cancel_button.clicked.connect(self._on_cancel)
        self.set_payment_button.clicked.connect(self._on_set_payment)

        self._build_layout()
        self.refresh()

    def _configure_columns(self) -> None:
        header = self.table.horizontalHeader()
        if header is None:
            return
        # Customer + Job/Mould stretch to use available width; the rest fit.
        for col in range(len(_COLUMNS)):
            mode = (
                QHeaderView.ResizeMode.Stretch
                if col in (2, 3)
                else QHeaderView.ResizeMode.ResizeToContents
            )
            header.setSectionResizeMode(col, mode)

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Invoice History"))
        layout.addWidget(
            horizontal_bar(
                (self.number_search, self.customer_search, self.status_filter, self.refresh_button)
            )
        )
        # Let the table shrink so the screen adapts to narrow windows; the table
        # scrolls internally and cells carry full-text tooltips.
        self.table.setMinimumWidth(320)
        layout.addWidget(self.table, stretch=1)
        layout.addWidget(self.status)
        # Action buttons wrap into a horizontally scrollable bar so they never
        # force the whole screen wider than a small window.
        layout.addWidget(
            horizontal_bar(
                (
                    self.open_button,
                    self.preview_button,
                    self.export_button,
                    self.print_button,
                    self.payment_combo,
                    self.set_payment_button,
                    self.duplicate_button,
                    self.cancel_button,
                )
            )
        )

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
                cell = QTableWidgetItem(value)
                cell.setToolTip(value)  # full text on hover (no lost data)
                self.table.setItem(row, col, cell)
        if not self._rows:
            self.status.show_info("No invoices yet. Create one from the Dashboard or New Invoice.")
        else:
            self.status.clear_status()
        self._sync_actions()

    def selected_row(self) -> InvoiceRow | None:
        row = self.table.currentRow()
        if 0 <= row < len(self._rows):
            return self._rows[row]
        return None

    def _sync_actions(self) -> None:
        selected = self.selected_row()
        has = selected is not None
        is_finalized = has and selected is not None and selected.status == InvoiceStatus.FINALIZED
        for b in (self.open_button, self.duplicate_button):
            b.setEnabled(has)
        for b in (
            self.preview_button,
            self.export_button,
            self.print_button,
            self.cancel_button,
            self.set_payment_button,
        ):
            b.setEnabled(bool(is_finalized))
        self.payment_combo.setEnabled(bool(is_finalized))

    # --- actions ---

    def open_selected(self) -> bool:
        selected = self.selected_row()
        if selected is None or self._navigator is None:
            return False
        self._navigator.open_invoice(selected.invoice_id)
        return True

    def duplicate_selected(self) -> bool:
        selected = self.selected_row()
        if selected is None:
            return False
        draft = self._controller.duplicate(selected.invoice_id)
        self.refresh()
        self.status.show_ok("Created a new draft copy.")
        if self._navigator is not None:
            self._navigator.open_invoice(draft.id)
        return True

    def _on_preview(self) -> None:
        selected = self.selected_row()
        if selected is None:
            return
        try:
            from invoice_generator.infrastructure.printing.windows_print_adapter import (
                open_default,
            )

            pdf = self._controller.preview_bytes(selected.invoice_id)
            tmp = Path(tempfile.gettempdir()) / f"{selected.number.replace('/', '_')}.pdf"
            tmp.write_bytes(pdf)
            open_default(str(tmp))
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="history.preview")

    def _on_export(self) -> None:
        selected = self.selected_row()
        if selected is None:
            return
        from PySide6.QtWidgets import QFileDialog

        suggested = f"{selected.number.replace('/', '_')}.pdf"
        path, _ = QFileDialog.getSaveFileName(self, "Export Invoice PDF", suggested, "PDF (*.pdf)")
        if not path:
            return
        try:
            self._controller.export(selected.invoice_id, path)
            self.status.show_ok(f"Exported to {path}")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="history.export")

    def _on_print(self) -> None:
        selected = self.selected_row()
        if selected is None:
            return
        try:
            self._controller.print(selected.invoice_id, tempfile.gettempdir())
            self.status.show_ok("Sent to printer.")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="history.print")

    def _on_set_payment(self) -> None:
        selected = self.selected_row()
        if selected is None:
            return
        try:
            status = PaymentStatus(self.payment_combo.currentText())
            self._controller.set_payment_status(selected.invoice_id, status)
            self.refresh()
            self.status.show_ok(f"Payment status set to {status.value}.")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="history.payment_status")

    def _on_cancel(self) -> None:
        selected = self.selected_row()
        if selected is None:
            return
        reason, ok = QInputDialog.getText(self, "Cancel Invoice", "Reason for cancellation:")
        if not ok or not reason.strip():
            return
        try:
            self._controller.cancel(
                selected.invoice_id, reason.strip(), when=datetime.now(UTC)
            )
            self.refresh()
            self.status.show_ok("Invoice cancelled (record preserved).")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="history.cancel")


__all__ = ["InvoiceListScreen"]

