"""Create/Edit invoice form widget (Task 48).

Thin PySide6 form over :class:`InvoiceFormController`. Sections: customer
selection (auto-populates Place of Supply), Place of Supply override, the
editable line-item table, a live totals display, and notes/terms. Actions:
Save Draft (permissive) and Finalize (strict). Preview/Print/Export buttons are
present but wired in the finalize/reprint task (Task 49).

The widget contains no SQL and no calculations: line edits trigger a totals
refresh computed by the controller through the calculation engine (DECISIONS
D-006/D-021). Keyboard shortcuts follow Req 25.2 (Ctrl+S save, Ctrl+N new).
"""

from __future__ import annotations

from datetime import date

from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.validation import ValidationResult
from invoice_generator.ui.common.line_item_table import LineItemTable
from invoice_generator.ui.invoices.invoice_form_controller import InvoiceFormController


class InvoiceForm(QWidget):
    def __init__(self, controller: InvoiceFormController) -> None:
        super().__init__()
        self._controller = controller

        self.customer_combo = QComboBox()
        self.pos_state = QLineEdit()
        self.pos_code = QLineEdit()
        self.notes = QLineEdit()
        self.terms = QLineEdit()
        self.line_table = LineItemTable()
        self.totals_label = QLabel("Grand Total: 0.00")

        # Service templates (Req 29, P2): quick-insert a reusable description.
        self.template_combo = QComboBox()
        self.insert_template_button = QPushButton("Insert Template")

        self.save_draft_button = QPushButton("Save Draft")
        self.finalize_button = QPushButton("Finalize")
        self.preview_button = QPushButton("Preview")  # wired in Task 49
        self.print_button = QPushButton("Print")  # wired in Task 49
        self.export_button = QPushButton("Export PDF")  # wired in Task 49

        self._wire()
        self._build_layout()
        self.reload_customers()
        self.reload_service_templates()

    def _wire(self) -> None:
        self.customer_combo.currentIndexChanged.connect(self._on_customer_changed)
        self.pos_state.textChanged.connect(self._sync_place_of_supply)
        self.pos_code.textChanged.connect(self._sync_place_of_supply)
        self.line_table.changed.connect(self.refresh_totals)
        self.insert_template_button.clicked.connect(self.insert_selected_template)
        self.save_draft_button.clicked.connect(self.save_draft)
        self.preview_button.clicked.connect(self._on_preview)
        self.export_button.clicked.connect(self._on_export)
        self.print_button.clicked.connect(self._on_print)
        QShortcut(QKeySequence.StandardKey.Save, self, self.save_draft)
        QShortcut(QKeySequence.StandardKey.New, self, self.new_invoice)

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        form = QFormLayout()
        form.addRow("Customer", self.customer_combo)
        form.addRow("Place of Supply", self.pos_state)
        form.addRow("PoS State Code", self.pos_code)
        layout.addLayout(form)
        template_row = QHBoxLayout()
        template_row.addWidget(QLabel("Service template"))
        template_row.addWidget(self.template_combo, stretch=1)
        template_row.addWidget(self.insert_template_button)
        layout.addLayout(template_row)
        layout.addWidget(self.line_table, stretch=1)
        layout.addWidget(self.totals_label)
        extra = QFormLayout()
        extra.addRow("Notes", self.notes)
        extra.addRow("Terms", self.terms)
        layout.addLayout(extra)
        buttons = QHBoxLayout()
        for b in (
            self.save_draft_button,
            self.finalize_button,
            self.preview_button,
            self.print_button,
            self.export_button,
        ):
            buttons.addWidget(b)
        layout.addLayout(buttons)

    # --- customers ---

    def reload_customers(self) -> None:
        self.customer_combo.blockSignals(True)
        self.customer_combo.clear()
        self._customers = list(self._controller.available_customers())
        self.customer_combo.addItem("-- Select customer --", userData=None)
        for customer in self._customers:
            self.customer_combo.addItem(customer.name, userData=str(customer.id))
        self.customer_combo.blockSignals(False)

    def _on_customer_changed(self, index: int) -> None:
        data = self.customer_combo.itemData(index)
        if not data:
            return
        import uuid

        working = self._controller.select_customer(uuid.UUID(str(data)))
        # Reflect the defaulted Place of Supply into the fields.
        self.pos_state.setText(working.place_of_supply.state_name)
        self.pos_code.setText(working.place_of_supply.state_code)
        self.refresh_totals()

    def _sync_place_of_supply(self) -> None:
        self._controller.set_place_of_supply(
            self.pos_state.text().strip(), self.pos_code.text().strip()
        )
        self.refresh_totals()

    # --- service templates (Req 29, P2) ---

    def reload_service_templates(self) -> None:
        self.template_combo.clear()
        self._templates = list(self._controller.available_service_templates())
        self.template_combo.addItem("-- Select template --", userData=None)
        for template in self._templates:
            self.template_combo.addItem(template.name, userData=str(template.id))
        # Nothing to insert until a real template is chosen.
        self.insert_template_button.setEnabled(bool(self._templates))

    def insert_selected_template(self) -> None:
        data = self.template_combo.currentData()
        if not data:
            return
        import uuid

        # Persist current table edits, insert the template line, then reflect
        # the controller's updated lines back into the editable table.
        self._controller.set_lines(self.line_table.collect_lines())
        self._controller.insert_service_template(uuid.UUID(str(data)))
        self.line_table.set_lines(self._controller.working.lines)
        self.refresh_totals()

    # --- totals (live) ---

    def refresh_totals(self) -> None:
        self._controller.set_lines(self.line_table.collect_lines())
        totals = self._controller.preview_totals()
        self.totals_label.setText(f"Grand Total: {totals.grand_total}")

    # --- actions ---

    def new_invoice(self) -> None:
        self._controller.new_draft()
        self.line_table.set_lines(())
        self.pos_state.clear()
        self.pos_code.clear()
        self.notes.clear()
        self.terms.clear()
        self.customer_combo.setCurrentIndex(0)
        self.refresh_totals()

    def _sync_working(self) -> None:
        self._controller.set_lines(self.line_table.collect_lines())
        self._controller.update_fields(
            notes=self.notes.text().strip(),
            terms=self.terms.text().strip(),
        )

    def save_draft(self) -> ValidationResult:
        self._sync_working()
        return self._controller.save_draft()

    def finalize(self, invoice_date: date) -> object:
        self._sync_working()
        return self._controller.finalize(invoice_date)

    def check_finalization(self, invoice_date: date) -> ValidationResult:
        self._sync_working()
        return self._controller.check_finalization(invoice_date)

    # --- preview / export / print (enabled once finalized) ---

    def _is_finalized(self) -> bool:
        return self._controller.working.invoice_number is not None

    def _on_preview(self) -> None:
        if not self._is_finalized():
            return
        # Render to a temp file and open via the OS default viewer (Task 29).
        import tempfile
        from pathlib import Path

        from invoice_generator.infrastructure.printing.windows_print_adapter import open_default

        pdf = self._controller.render_preview()
        tmp = Path(tempfile.gettempdir()) / self._controller.default_export_filename()
        tmp.write_bytes(pdf)
        open_default(str(tmp))

    def _on_export(self) -> None:
        if not self._is_finalized():
            return
        from PySide6.QtWidgets import QFileDialog

        suggested = self._controller.default_export_filename()
        path, _ = QFileDialog.getSaveFileName(self, "Export Invoice PDF", suggested, "PDF (*.pdf)")
        if path:
            self._controller.export(path)

    def _on_print(self) -> None:
        if not self._is_finalized():
            return
        import tempfile

        self._controller.print(tempfile.gettempdir())


__all__ = ["InvoiceForm"]
