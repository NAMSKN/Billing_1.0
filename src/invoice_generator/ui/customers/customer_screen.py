"""Customer screen widget (Task 47).

A thin PySide6 screen over :class:`CustomerController`: a table of active
customers plus a form to add/edit and an archive action. All persistence and
validation go through the controller (no SQL, no rules in the widget —
DECISIONS D-021). Internal UUIDs are never shown as table columns (Req 30.7);
the widget keeps the selected customer object internally.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QAbstractItemView,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.models import Address, Customer
from invoice_generator.domain.validation import ValidationResult
from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary, scrollable, title_label
from invoice_generator.ui.customers.customer_controller import CustomerController

_COLUMNS = ("Name", "GSTIN", "State", "Phone", "Email")  # no UUID column (Req 30.7)


class CustomerScreen(QWidget):
    def __init__(self, controller: CustomerController) -> None:
        super().__init__()
        self._controller = controller
        self._rows: list[Customer] = []
        self._editing: Customer = Customer()

        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.itemSelectionChanged.connect(self._on_selection_changed)

        self.name = QLineEdit()
        self.gstin = QLineEdit()
        self.bill_line = QLineEdit()
        self.state_name = QLineEdit()
        self.state_code = QLineEdit()
        self.phone = QLineEdit()
        self.email = QLineEdit()

        self.gstin.setPlaceholderText("15-char GSTIN, e.g. 27AAIFD4249A1ZQ")
        self.state_code.setPlaceholderText("e.g. 27")

        self.status = StatusBanner()
        self.new_button = QPushButton("New")
        self.save_button = make_primary(QPushButton("Save"))
        self.archive_button = QPushButton("Archive")
        self.new_button.clicked.connect(self.new_customer)
        self.save_button.clicked.connect(self.save_current)
        self.archive_button.clicked.connect(self.archive_selected)

        self._build_layout()
        self.refresh()

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        inner.addWidget(title_label("Customers"))
        inner.addWidget(self.table, stretch=1)

        form = QFormLayout()
        form.addRow("Name", self.name)
        form.addRow("GSTIN", self.gstin)
        form.addRow("Billing Address", self.bill_line)
        form.addRow("State", self.state_name)
        form.addRow("State Code", self.state_code)
        form.addRow("Phone", self.phone)
        form.addRow("Email", self.email)
        inner.addLayout(form)

        layout = QVBoxLayout(self)
        layout.addWidget(scrollable(body), stretch=1)
        layout.addWidget(self.status)
        buttons = QHBoxLayout()
        buttons.addWidget(self.new_button)
        buttons.addWidget(self.save_button)
        buttons.addWidget(self.archive_button)
        buttons.addStretch(1)
        layout.addLayout(buttons)

    # --- data ---

    def refresh(self) -> None:
        """Reload the active-customer list into the table."""
        self._rows = list(self._controller.list_customers())
        self.table.setRowCount(len(self._rows))
        for row, customer in enumerate(self._rows):
            values = (
                customer.name,
                customer.gstin,
                _format_state(customer.bill_to),
                customer.phone,
                customer.email,
            )
            for col, value in enumerate(values):
                cell = QTableWidgetItem(value)
                cell.setToolTip(value)
                self.table.setItem(row, col, cell)
        if not self._rows:
            self.status.show_info("No customers yet. Fill the form and click Save.")

    def new_customer(self) -> None:
        """Clear the form to enter a new customer."""
        self._editing = Customer()
        self._clear_form()

    def _on_selection_changed(self) -> None:
        row = self.table.currentRow()
        if 0 <= row < len(self._rows):
            self._load_form(self._rows[row])

    def _load_form(self, customer: Customer) -> None:
        self._editing = customer
        self.name.setText(customer.name)
        self.gstin.setText(customer.gstin)
        self.bill_line.setText(customer.bill_to.line)
        self.state_name.setText(customer.bill_to.state_name)
        self.state_code.setText(customer.bill_to.state_code)
        self.phone.setText(customer.phone)
        self.email.setText(customer.email)

    def _clear_form(self) -> None:
        for field in (
            self.name,
            self.gstin,
            self.bill_line,
            self.state_name,
            self.state_code,
            self.phone,
            self.email,
        ):
            field.clear()

    def collect_customer(self) -> Customer:
        """Build a Customer from the form, preserving the edited id/ship-to."""
        bill = Address(
            line=self.bill_line.text().strip(),
            state_name=self.state_name.text().strip(),
            state_code=self.state_code.text().strip(),
        )
        return self._editing.model_copy(
            update={
                "name": self.name.text().strip(),
                "gstin": self.gstin.text().strip(),
                "bill_to": bill,
                "phone": self.phone.text().strip(),
                "email": self.email.text().strip(),
            }
        )

    def save_current(self) -> ValidationResult:
        """Validate and save the form's customer; refresh the list on success."""
        customer = self.collect_customer()
        result = self._controller.save(customer)
        if result.is_ok:
            self._editing = customer
            self.refresh()
            self.status.show_ok(f"Customer '{customer.name}' saved.")
        else:
            fields = ", ".join(sorted({i.field for i in result.blocking}))
            self.status.show_error(f"Not saved. Please fix: {fields}")
        return result

    def archive_selected(self) -> bool:
        """Archive the selected customer; returns True if one was archived."""
        row = self.table.currentRow()
        if not (0 <= row < len(self._rows)):
            return False
        self._controller.archive(self._rows[row].id)
        self.refresh()
        self.new_customer()
        self.status.show_info("Customer archived.")
        return True


def _format_state(address: Address) -> str:
    if address.state_name and address.state_code:
        return f"{address.state_name} ({address.state_code})"
    return address.state_name or address.state_code


__all__ = ["CustomerScreen"]
