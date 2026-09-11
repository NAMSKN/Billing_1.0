"""Settings screen widget (Task 46 + UI remediation).

A thin PySide6 form over :class:`SettingsController`: company, bank, numbering,
and tax-rate inputs, a company-logo workflow (import/preview/remove), and a
service-template manager. All persistence/validation goes through the controller
(no SQL or business rules in the widget — DECISIONS D-021).

Remediation: the body scrolls (never clips at small window sizes); Save surfaces
success and blocking-validation feedback via a status banner and the error
boundary instead of failing silently; the logo and service-template capabilities
are now reachable from the UI.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.models import (
    Address,
    Company,
    ServiceTemplate,
    TaxRateConfig,
)
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.validation import ValidationResult
from invoice_generator.ui.common.errors import report_error
from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary, scrollable, title_label
from invoice_generator.ui.settings.settings_controller import SettingsController

_TEMPLATE_COLUMNS = ("Name", "Description", "HSN/SAC", "Unit")


class SettingsScreen(QWidget):
    def __init__(self, controller: SettingsController) -> None:
        super().__init__()
        self._controller = controller
        self._current = controller.load_company()
        self._editing_template = ServiceTemplate()
        self._template_rows: list[ServiceTemplate] = []

        # Company fields.
        self.name = QLineEdit()
        self.address_line = QLineEdit()
        self.state_name = QLineEdit()
        self.state_code = QLineEdit()
        self.gstin = QLineEdit()
        self.email = QLineEdit()
        self.phone = QLineEdit()
        # Bank fields.
        self.bank_name = QLineEdit()
        self.account_number = QLineEdit()
        self.branch = QLineEdit()
        self.ifsc = QLineEdit()
        self.upi_id = QLineEdit()
        # Numbering fields.
        self.prefix = QLineEdit()
        self.pad_width = QLineEdit()
        self.start_value = QLineEdit()
        # Tax fields.
        self.total_rate = QLineEdit()
        self.cgst_rate = QLineEdit()
        self.sgst_rate = QLineEdit()
        self.igst_rate = QLineEdit()
        self._add_field_hints()

        # Logo widgets.
        self.logo_preview = QLabel("No logo configured")
        self.logo_preview.setFixedHeight(72)
        self.logo_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.import_logo_button = QPushButton("Import Logo\u2026")
        self.remove_logo_button = QPushButton("Remove Logo")
        self.import_logo_button.clicked.connect(self._on_import_logo)
        self.remove_logo_button.clicked.connect(self._on_remove_logo)

        # Service-template widgets.
        self.template_table = QTableWidget(0, len(_TEMPLATE_COLUMNS))
        self.template_table.setHorizontalHeaderLabels(list(_TEMPLATE_COLUMNS))
        self.template_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.template_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.template_table.itemSelectionChanged.connect(self._on_template_selected)
        self.tmpl_name = QLineEdit()
        self.tmpl_description = QLineEdit()
        self.tmpl_hsn = QLineEdit()
        self.tmpl_unit = QLineEdit()
        self.tmpl_new_button = QPushButton("New")
        self.tmpl_save_button = QPushButton("Save Template")
        self.tmpl_delete_button = QPushButton("Delete")
        self.tmpl_new_button.clicked.connect(self._on_template_new)
        self.tmpl_save_button.clicked.connect(self._on_template_save)
        self.tmpl_delete_button.clicked.connect(self._on_template_delete)

        self.status = StatusBanner()
        self.save_button = make_primary(QPushButton("Save Settings"))
        self.save_button.clicked.connect(self.save)

        self._build_layout()
        self.load()
        self.refresh_templates()
        self._refresh_logo_preview()

    def _add_field_hints(self) -> None:
        self.gstin.setPlaceholderText("e.g. 27DEZPS3898C1ZH (15-char GSTIN)")
        self.state_code.setPlaceholderText("e.g. 27")
        self.ifsc.setPlaceholderText("e.g. SBIN0021282")
        self.pad_width.setPlaceholderText("digits, e.g. 3")
        self.start_value.setPlaceholderText("first number, e.g. 1")
        self.total_rate.setToolTip("Total GST rate, e.g. 18")
        self.cgst_rate.setToolTip("Half of total for intra-state, e.g. 9")
        self.sgst_rate.setToolTip("Half of total for intra-state, e.g. 9")
        self.igst_rate.setToolTip("Full rate for inter-state, e.g. 18")

    # --- layout ---

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        inner.addWidget(title_label("Company Settings"))
        inner.addWidget(self._company_group())
        inner.addWidget(self._logo_group())
        inner.addWidget(self._bank_group())
        inner.addWidget(self._numbering_group())
        inner.addWidget(self._tax_group())
        inner.addWidget(self._templates_group())
        inner.addStretch(1)

        outer = QVBoxLayout(self)
        outer.addWidget(scrollable(body), stretch=1)
        footer = QHBoxLayout()
        footer.addWidget(self.status, stretch=1)
        footer.addWidget(self.save_button)
        outer.addLayout(footer)

    def _company_group(self) -> QGroupBox:
        box = QGroupBox("Company")
        form = QFormLayout(box)
        form.addRow("Name", self.name)
        form.addRow("Address", self.address_line)
        form.addRow("State", self.state_name)
        form.addRow("State Code", self.state_code)
        form.addRow("GSTIN", self.gstin)
        form.addRow("Email", self.email)
        form.addRow("Phone", self.phone)
        return box

    def _logo_group(self) -> QGroupBox:
        box = QGroupBox("Company Logo")
        layout = QVBoxLayout(box)
        layout.addWidget(self.logo_preview)
        buttons = QHBoxLayout()
        buttons.addWidget(self.import_logo_button)
        buttons.addWidget(self.remove_logo_button)
        buttons.addStretch(1)
        layout.addLayout(buttons)
        return box

    def _bank_group(self) -> QGroupBox:
        box = QGroupBox("Bank / Payment")
        form = QFormLayout(box)
        form.addRow("Bank Name", self.bank_name)
        form.addRow("Account No.", self.account_number)
        form.addRow("Branch", self.branch)
        form.addRow("IFSC", self.ifsc)
        form.addRow("UPI ID", self.upi_id)
        return box

    def _numbering_group(self) -> QGroupBox:
        box = QGroupBox("Invoice Numbering")
        form = QFormLayout(box)
        form.addRow("Prefix", self.prefix)
        form.addRow("Pad Width", self.pad_width)
        form.addRow("Start Value", self.start_value)
        return box

    def _tax_group(self) -> QGroupBox:
        box = QGroupBox("GST Rates (%)")
        form = QFormLayout(box)
        form.addRow("Total", self.total_rate)
        form.addRow("CGST", self.cgst_rate)
        form.addRow("SGST", self.sgst_rate)
        form.addRow("IGST", self.igst_rate)
        return box

    def _templates_group(self) -> QGroupBox:
        box = QGroupBox("Service Templates")
        layout = QVBoxLayout(box)
        layout.addWidget(self.template_table)
        form = QFormLayout()
        form.addRow("Name", self.tmpl_name)
        form.addRow("Description", self.tmpl_description)
        form.addRow("HSN/SAC", self.tmpl_hsn)
        form.addRow("Unit", self.tmpl_unit)
        layout.addLayout(form)
        buttons = QHBoxLayout()
        buttons.addWidget(self.tmpl_new_button)
        buttons.addWidget(self.tmpl_save_button)
        buttons.addWidget(self.tmpl_delete_button)
        buttons.addStretch(1)
        layout.addLayout(buttons)
        return box

    # --- load / collect / save ---

    def load(self) -> None:
        """Populate fields from stored settings via the controller."""
        c = self._controller.load_company()
        self._current = c
        self.name.setText(c.name)
        self.address_line.setText(c.address.line)
        self.state_name.setText(c.address.state_name)
        self.state_code.setText(c.address.state_code)
        self.gstin.setText(c.gstin)
        self.email.setText(c.email)
        self.phone.setText(c.phone)
        self.bank_name.setText(c.bank_name)
        self.account_number.setText(c.account_number)
        self.branch.setText(c.branch)
        self.ifsc.setText(c.ifsc)
        self.upi_id.setText(c.upi_id)

        numbering = self._controller.load_numbering_config()
        self.prefix.setText(numbering.prefix)
        self.pad_width.setText(str(numbering.pad_width))
        self.start_value.setText(str(numbering.start_value))

        tax = self._controller.load_tax_config()
        self.total_rate.setText(str(tax.total_rate))
        self.cgst_rate.setText(str(tax.cgst_rate))
        self.sgst_rate.setText(str(tax.sgst_rate))
        self.igst_rate.setText(str(tax.igst_rate))

    def collect_company(self) -> Company:
        """Build a Company from the current field values (preserving id/assets)."""
        return self._current.model_copy(
            update={
                "name": self.name.text().strip(),
                "address": Address(
                    line=self.address_line.text().strip(),
                    state_name=self.state_name.text().strip(),
                    state_code=self.state_code.text().strip(),
                ),
                "gstin": self.gstin.text().strip(),
                "email": self.email.text().strip(),
                "phone": self.phone.text().strip(),
                "bank_name": self.bank_name.text().strip(),
                "account_number": self.account_number.text().strip(),
                "branch": self.branch.text().strip(),
                "ifsc": self.ifsc.text().strip(),
                "upi_id": self.upi_id.text().strip(),
            }
        )

    def collect_numbering(self) -> NumberingConfig:
        return NumberingConfig(
            prefix=self.prefix.text().strip() or "SE",
            pad_width=_to_int(self.pad_width.text(), default=3),
            start_value=_to_int(self.start_value.text(), default=1),
        )

    def collect_tax(self) -> TaxRateConfig:
        return TaxRateConfig(
            total_rate=_to_decimal(self.total_rate.text()),
            cgst_rate=_to_decimal(self.cgst_rate.text()),
            sgst_rate=_to_decimal(self.sgst_rate.text()),
            igst_rate=_to_decimal(self.igst_rate.text()),
        )

    def save(self) -> ValidationResult:
        """Persist numbering + tax + company and surface the result to the user.

        Numbering and tax are persisted first; company is validated and saved
        only if valid. Blocking validation issues are shown (no silent failure),
        and unexpected errors go through the error boundary.
        """
        try:
            self._controller.save_numbering_config(self.collect_numbering())
            self._controller.save_tax_config(self.collect_tax())
            result = self._controller.save_company(self.collect_company())
        except Exception as exc:  # noqa: BLE001 - boundary: report, never crash
            self.status.show_error(report_error(exc, context="settings.save"))
            return ValidationResult(())

        if result.is_ok:
            self._current = self.collect_company()
            self.status.show_ok("Settings saved.")
        else:
            fields = ", ".join(sorted({i.field for i in result.blocking}))
            self.status.show_error(f"Not saved. Please fix: {fields}")
        return result

    # --- logo ---

    def _on_import_logo(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Select Logo Image", "", "Images (*.png *.jpg *.jpeg *.bmp)"
        )
        if not path:
            return
        asset = self._controller.set_company_logo(path)
        if asset is None:
            self.status.show_error("Could not read that image file.")
            return
        self._current = self._controller.load_company()
        self._refresh_logo_preview()
        self.status.show_ok("Logo updated.")

    def _on_remove_logo(self) -> None:
        self._controller.remove_company_logo()
        self._current = self._controller.load_company()
        self._refresh_logo_preview()
        self.status.show_info("Logo removed.")

    def set_logo(self, source_path: str) -> bool:
        """Headless logo import (used by tests); returns True on success."""
        asset = self._controller.set_company_logo(source_path)
        if asset is None:
            return False
        self._current = self._controller.load_company()
        self._refresh_logo_preview()
        return True

    def _refresh_logo_preview(self) -> None:
        asset = self._controller.current_logo()
        if asset is None:
            self.logo_preview.setText("No logo configured")
            self.logo_preview.setPixmap(QPixmap())
            self.remove_logo_button.setEnabled(False)
            return
        pixmap = QPixmap(asset.stored_path)
        if pixmap.isNull():
            self.logo_preview.setText(f"Logo v{asset.version} (preview unavailable)")
        else:
            self.logo_preview.setText("")
            self.logo_preview.setPixmap(
                pixmap.scaledToHeight(64, Qt.TransformationMode.SmoothTransformation)
            )
        self.remove_logo_button.setEnabled(True)

    # --- service templates ---

    def refresh_templates(self) -> None:
        self._template_rows = list(self._controller.list_service_templates())
        self.template_table.setRowCount(len(self._template_rows))
        for row, t in enumerate(self._template_rows):
            for col, value in enumerate((t.name, t.description, t.hsn_sac, t.unit)):
                item = QTableWidgetItem(value)
                item.setToolTip(value)
                self.template_table.setItem(row, col, item)

    def _on_template_selected(self) -> None:
        row = self.template_table.currentRow()
        if 0 <= row < len(self._template_rows):
            t = self._template_rows[row]
            self._editing_template = t
            self.tmpl_name.setText(t.name)
            self.tmpl_description.setText(t.description)
            self.tmpl_hsn.setText(t.hsn_sac)
            self.tmpl_unit.setText(t.unit)

    def _on_template_new(self) -> None:
        self._editing_template = ServiceTemplate()
        for f in (self.tmpl_name, self.tmpl_description, self.tmpl_hsn, self.tmpl_unit):
            f.clear()

    def _on_template_save(self) -> None:
        name = self.tmpl_name.text().strip()
        if not name:
            self.status.show_error("Template name is required.")
            return
        template = self._editing_template.model_copy(
            update={
                "name": name,
                "description": self.tmpl_description.text().strip(),
                "hsn_sac": self.tmpl_hsn.text().strip(),
                "unit": self.tmpl_unit.text().strip(),
            }
        )
        self._controller.save_service_template(template)
        self._editing_template = template
        self.refresh_templates()
        self.status.show_ok(f"Template '{name}' saved.")

    def _on_template_delete(self) -> None:
        row = self.template_table.currentRow()
        if not (0 <= row < len(self._template_rows)):
            return
        self._controller.delete_service_template(self._template_rows[row].id)
        self._on_template_new()
        self.refresh_templates()
        self.status.show_info("Template deleted.")


def _to_int(text: str, *, default: int) -> int:
    try:
        return int(text.strip())
    except ValueError:
        return default


def _to_decimal(text: str) -> Decimal:
    try:
        return Decimal(text.strip())
    except (InvalidOperation, ArithmeticError):
        return Decimal(0)


__all__ = ["SettingsScreen"]
