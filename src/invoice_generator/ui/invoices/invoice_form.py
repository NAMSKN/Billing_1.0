"""Create/Edit invoice form widget (Task 48 + UI remediation).

Thin PySide6 form over :class:`InvoiceFormController`. Sections: customer
selection (auto-populates Place of Supply), Place of Supply override, an invoice
date, a service-template quick-insert, the editable line-item table, a full live
calculation breakdown, and notes/terms. Actions: Save Draft, Finalize, Preview,
Export PDF, Print.

Remediation: the body scrolls; the calculation breakdown shows taxable, CGST,
SGST, IGST, subtotal, round-off and grand total (all engine-computed via the
controller); Finalize is wired (previously dead) with a real invoice date and
error-boundary reporting; after finalize the number is shown and inputs lock,
enabling Preview/Export/Print; an existing invoice can be loaded for edit/view.
The widget performs no SQL and no calculations (DECISIONS D-006/D-021).
"""

from __future__ import annotations

import tempfile
import uuid
from datetime import date
from pathlib import Path

from PySide6.QtCore import QDate
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QComboBox,
    QDateEdit,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.models import ServiceTemplate
from invoice_generator.domain.validation import ValidationResult
from invoice_generator.ui.common.errors import report_error, show_error_dialog
from invoice_generator.ui.common.line_item_table import LineItemTable
from invoice_generator.ui.common.navigation import Navigator
from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary, scrollable, title_label
from invoice_generator.ui.invoices.invoice_form_controller import (
    FinalizationError,
    InvoiceFormController,
)
from invoice_generator.ui.invoices.template_picker import TemplatePickerDialog


class InvoiceForm(QWidget):
    def __init__(
        self,
        controller: InvoiceFormController,
        navigator: Navigator | None = None,
    ) -> None:
        super().__init__()
        self._controller = controller
        self._navigator = navigator

        self.title = title_label("Create Invoice")
        self.number_label = QLabel("Draft (not yet finalized)")
        self.number_label.setObjectName("sectionTitle")

        self.customer_combo = QComboBox()
        self.pos_state = QLineEdit()
        self.pos_code = QLineEdit()
        self.pos_code.setPlaceholderText("Place of supply state code, e.g. 27")
        self.invoice_date = QDateEdit()
        self.invoice_date.setCalendarPopup(True)
        self.invoice_date.setDisplayFormat("dd-MMM-yyyy")
        self.invoice_date.setDate(QDate.currentDate())
        self.notes = QLineEdit()
        self.terms = QLineEdit()
        self.line_table = LineItemTable()

        # Service templates: an explicit "Insert Template" button opens a picker
        # dialog. The button stays enabled for drafts even with zero templates,
        # so the picker can show its empty-state guidance to Settings.
        self.insert_template_button = QPushButton("Insert Template\u2026")
        self._templates: list[ServiceTemplate] = []

        # Calculation breakdown labels.
        self.taxable_label = QLabel("0.00")
        self.cgst_label = QLabel("0.00")
        self.sgst_label = QLabel("0.00")
        self.igst_label = QLabel("0.00")
        self.subtotal_label = QLabel("0.00")
        self.round_off_label = QLabel("0.00")
        self.grand_total_label = QLabel("0.00")
        self.grand_total_label.setObjectName("totalsGrand")

        self.status = StatusBanner()
        self.save_draft_button = QPushButton("Save Draft")
        self.finalize_button = make_primary(QPushButton("Finalize"))
        self.preview_button = QPushButton("Preview")
        self.print_button = QPushButton("Print")
        self.export_button = QPushButton("Export PDF")

        self._wire()
        self._build_layout()
        self.reload_customers()
        self.reload_service_templates()
        self._sync_action_state()

    def _wire(self) -> None:
        self.customer_combo.currentIndexChanged.connect(self._on_customer_changed)
        self.pos_state.textChanged.connect(self._sync_place_of_supply)
        self.pos_code.textChanged.connect(self._sync_place_of_supply)
        self.line_table.changed.connect(self.refresh_totals)
        self.insert_template_button.clicked.connect(self.insert_selected_template)
        self.save_draft_button.clicked.connect(self._on_save_draft)
        self.finalize_button.clicked.connect(self._on_finalize)
        self.preview_button.clicked.connect(self._on_preview)
        self.export_button.clicked.connect(self._on_export)
        self.print_button.clicked.connect(self._on_print)
        QShortcut(QKeySequence.StandardKey.Save, self, self._on_save_draft)
        QShortcut(QKeySequence.StandardKey.New, self, self.new_invoice)

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        header = QHBoxLayout()
        header.addWidget(self.title, stretch=1)
        header.addWidget(self.number_label)
        inner.addLayout(header)

        form = QFormLayout()
        form.addRow("Customer", self.customer_combo)
        form.addRow("Invoice Date", self.invoice_date)
        form.addRow("Place of Supply", self.pos_state)
        form.addRow("PoS State Code", self.pos_code)
        inner.addLayout(form)

        lines_header = QHBoxLayout()
        lines_title = QLabel("Line Items")
        lines_title.setObjectName("sectionTitle")
        lines_header.addWidget(lines_title, stretch=1)
        lines_header.addWidget(self.insert_template_button)
        inner.addLayout(lines_header)

        inner.addWidget(self.line_table, stretch=1)
        inner.addWidget(self._totals_group())

        extra = QFormLayout()
        extra.addRow("Notes", self.notes)
        extra.addRow("Terms", self.terms)
        inner.addLayout(extra)

        outer = QVBoxLayout(self)
        outer.addWidget(scrollable(body), stretch=1)
        outer.addWidget(self.status)
        buttons = QHBoxLayout()
        buttons.addWidget(self.save_draft_button)
        buttons.addWidget(self.finalize_button)
        buttons.addStretch(1)
        buttons.addWidget(self.preview_button)
        buttons.addWidget(self.export_button)
        buttons.addWidget(self.print_button)
        outer.addLayout(buttons)

    def _totals_group(self) -> QGroupBox:
        box = QGroupBox("Calculation Summary")
        form = QFormLayout(box)
        form.addRow("Taxable Amount", self.taxable_label)
        form.addRow("CGST", self.cgst_label)
        form.addRow("SGST", self.sgst_label)
        form.addRow("IGST", self.igst_label)
        form.addRow("Subtotal", self.subtotal_label)
        form.addRow("Round Off", self.round_off_label)
        form.addRow("Grand Total", self.grand_total_label)
        return box

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
        working = self._controller.select_customer(uuid.UUID(str(data)))
        self.pos_state.setText(working.place_of_supply.state_name)
        self.pos_code.setText(working.place_of_supply.state_code)
        self.refresh_totals()

    def _sync_place_of_supply(self) -> None:
        self._controller.set_place_of_supply(
            self.pos_state.text().strip(), self.pos_code.text().strip()
        )
        self.refresh_totals()

    # --- service templates ---

    def reload_service_templates(self) -> None:
        """Refresh the cached template list used by the picker dialog."""
        self._templates = list(self._controller.available_service_templates())

    def insert_selected_template(self) -> None:
        """Open the picker dialog and insert the chosen template as a new line.

        Empty-state, cancel, and errors are all handled: existing line items are
        preserved, and totals recalculate through the engine on a successful
        insert (DECISIONS D-006). Cancelling leaves the invoice unchanged.
        """
        if self._controller.is_finalized():
            self.status.show_info("Finalized invoices cannot be edited.")
            return
        self.reload_service_templates()
        dialog = TemplatePickerDialog(self._templates, self)
        if dialog.exec() != int(TemplatePickerDialog.DialogCode.Accepted):
            # Cancelled or dismissed: invoice unchanged.
            if not self._templates:
                self._offer_settings_navigation()
            return
        template_id = dialog.selected_id()
        if template_id is None:
            return
        self.insert_template(template_id)

    def insert_template(self, template_id: uuid.UUID) -> bool:
        """Insert a template as a new editable line and recalc; return success.

        The direct insert path (also the dialog's chosen action). Preserves any
        existing edits and lines, recalculates via the engine, and surfaces
        errors (e.g. a template deleted between listing and insert) through the
        status banner.
        """
        try:
            # Keep any edits the operator has already made before inserting.
            self._controller.set_lines(self.line_table.collect_lines())
            line = self._controller.insert_service_template(template_id)
            self.line_table.set_lines(self._controller.working.lines)
            self.refresh_totals()
        except ValueError as exc:
            # Template was deleted between listing and insert.
            self.status.show_error(report_error(exc, context="invoice.insert_template"))
            return False
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(report_error(exc, context="invoice.insert_template"))
            return False
        self.status.show_ok(f"Inserted template line: {line.description or line.hsn_sac}.")
        return True

    def _offer_settings_navigation(self) -> None:
        """When no templates exist, guide the operator to Settings."""
        from PySide6.QtWidgets import QMessageBox

        box = QMessageBox(self)
        box.setWindowTitle("No Service Templates")
        box.setText(
            "You have no service templates yet.\n\n"
            "Would you like to open Settings to create one?"
        )
        box.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if box.exec() == int(QMessageBox.StandardButton.Yes) and self._navigator is not None:
            self._navigator.go_to("Settings")

    # --- totals (live, engine-computed) ---

    def refresh_totals(self) -> None:
        self._controller.set_lines(self.line_table.collect_lines())
        totals = self._controller.preview_totals()
        self.taxable_label.setText(_money(totals.total_taxable))
        self.cgst_label.setText(_money(totals.total_cgst))
        self.sgst_label.setText(_money(totals.total_sgst))
        self.igst_label.setText(_money(totals.total_igst))
        self.subtotal_label.setText(_money(totals.raw_total))
        self.round_off_label.setText(_money(totals.round_off))
        self.grand_total_label.setText(_money(totals.grand_total))

    # --- actions ---

    def new_invoice(self) -> None:
        self._controller.new_draft()
        self.line_table.set_lines(())
        self.pos_state.clear()
        self.pos_code.clear()
        self.notes.clear()
        self.terms.clear()
        self.customer_combo.setCurrentIndex(0)
        self.status.clear_status()
        self.refresh_totals()
        self._sync_action_state()

    def load_invoice(self, invoice_id: uuid.UUID) -> None:
        """Open an existing invoice (from History/Dashboard) for view/edit."""
        try:
            invoice = self._controller.load_invoice(invoice_id)
        except ValueError as exc:
            self.status.show_error(report_error(exc, context="invoice.load"))
            return
        self._reflect_working(invoice)
        self._sync_action_state()

    def _reflect_working(self, invoice: object) -> None:
        inv = self._controller.working
        # Customer selection.
        idx = self.customer_combo.findData(
            str(inv.customer_id) if inv.customer_id is not None else None
        )
        self.customer_combo.blockSignals(True)
        self.customer_combo.setCurrentIndex(max(idx, 0))
        self.customer_combo.blockSignals(False)
        self.pos_state.setText(inv.place_of_supply.state_name)
        self.pos_code.setText(inv.place_of_supply.state_code)
        self.notes.setText(inv.notes)
        self.terms.setText(inv.terms)
        self.line_table.set_lines(inv.lines)
        if inv.invoice_date:
            parsed = QDate.fromString(inv.invoice_date, "yyyy-MM-dd")
            if parsed.isValid():
                self.invoice_date.setDate(parsed)
        self.refresh_totals()

    def _sync_working(self) -> None:
        self._controller.set_lines(self.line_table.collect_lines())
        self._controller.update_fields(
            notes=self.notes.text().strip(),
            terms=self.terms.text().strip(),
        )

    def _selected_date(self) -> date:
        qd = self.invoice_date.date()
        return date(qd.year(), qd.month(), qd.day())

    def _on_save_draft(self) -> ValidationResult:
        return self.save_draft()

    def save_draft(self) -> ValidationResult:
        if self._controller.is_finalized():
            self.status.show_info("Finalized invoices cannot be edited.")
            return ValidationResult(())
        self._sync_working()
        try:
            result = self._controller.save_draft()
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(report_error(exc, context="invoice.save_draft"))
            return ValidationResult(())
        warnings = ", ".join(sorted({i.field for i in result.warnings}))
        if warnings:
            self.status.show_info(f"Draft saved. Incomplete: {warnings}")
        else:
            self.status.show_ok("Draft saved.")
        return result

    def _on_finalize(self) -> None:
        self.finalize(self._selected_date())

    def finalize(self, invoice_date: date) -> object | None:
        if self._controller.is_finalized():
            self.status.show_info("This invoice is already finalized.")
            return None
        self._sync_working()
        # Save the draft first so the invoice exists, then finalize strictly.
        self.save_draft()
        try:
            finalized = self._controller.finalize(invoice_date)
        except FinalizationError as exc:
            self.status.show_error(report_error(exc, context="invoice.finalize"))
            return None
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(report_error(exc, context="invoice.finalize"))
            return None
        self.status.show_ok(f"Finalized as {finalized.invoice_number}.")
        self._sync_action_state()
        return finalized

    def check_finalization(self, invoice_date: date) -> ValidationResult:
        self._sync_working()
        return self._controller.check_finalization(invoice_date)

    # --- field locking + action availability ---

    def _sync_action_state(self) -> None:
        finalized = self._controller.is_finalized()
        if finalized:
            self.title.setText("View Invoice")
            self.number_label.setText(f"Invoice {self._controller.working.invoice_number}")
        else:
            self.title.setText("Create / Edit Invoice")
            self.number_label.setText("Draft (not yet finalized)")
        # Inputs are editable only for drafts (finalized invoices are immutable).
        for w in (
            self.customer_combo,
            self.pos_state,
            self.pos_code,
            self.invoice_date,
            self.notes,
            self.terms,
            self.line_table,
            self.save_draft_button,
            self.finalize_button,
        ):
            w.setEnabled(not finalized)
        # Insert-template is enabled for any draft (the picker shows an empty
        # state and guides to Settings when there are no templates yet).
        self.insert_template_button.setEnabled(not finalized)
        # Output actions are available only once finalized.
        for w in (self.preview_button, self.export_button, self.print_button):
            w.setEnabled(finalized)

    # --- preview / export / print (enabled once finalized) ---

    def _on_preview(self) -> None:
        if not self._controller.is_finalized():
            return
        try:
            from invoice_generator.infrastructure.printing.windows_print_adapter import (
                open_default,
            )

            pdf = self._controller.render_preview()
            tmp = Path(tempfile.gettempdir()) / self._controller.default_export_filename()
            tmp.write_bytes(pdf)
            open_default(str(tmp))
            self.status.show_ok("Preview opened.")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="invoice.preview")

    def _on_export(self) -> None:
        if not self._controller.is_finalized():
            return
        suggested = self._controller.default_export_filename()
        path, _ = QFileDialog.getSaveFileName(self, "Export Invoice PDF", suggested, "PDF (*.pdf)")
        if not path:
            return
        try:
            self._controller.export(path)
            self.status.show_ok(f"Exported to {path}")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="invoice.export")

    def _on_print(self) -> None:
        if not self._controller.is_finalized():
            return
        try:
            self._controller.print(tempfile.gettempdir())
            self.status.show_ok("Sent to printer.")
        except Exception as exc:  # noqa: BLE001 - boundary
            show_error_dialog(self, exc, context="invoice.print")


def _money(value: object) -> str:
    return f"{value}"


__all__ = ["InvoiceForm"]
