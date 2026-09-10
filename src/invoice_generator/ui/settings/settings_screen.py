"""Settings screen widget (Task 46).

A thin PySide6 form over :class:`SettingsController`: it collects company, bank,
numbering, and tax-rate inputs and delegates all persistence/validation to the
controller (no SQL or business rules in the widget — DECISIONS D-021). Loading
populates the fields from stored settings; saving gathers the fields and returns
the validation result so the caller can surface field-level messages (Req 25.3).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from PySide6.QtWidgets import (
    QFormLayout,
    QGroupBox,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.models import Address, Company, TaxRateConfig
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.validation import ValidationResult
from invoice_generator.ui.settings.settings_controller import SettingsController


class SettingsScreen(QWidget):
    def __init__(self, controller: SettingsController) -> None:
        super().__init__()
        self._controller = controller
        self._current = controller.load_company()

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

        self.save_button = QPushButton("Save Settings")
        self.save_button.clicked.connect(self.save)

        self._build_layout()
        self.load()

    # --- layout ---

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        layout.addWidget(self._company_group())
        layout.addWidget(self._bank_group())
        layout.addWidget(self._numbering_group())
        layout.addWidget(self._tax_group())
        layout.addWidget(self.save_button)
        layout.addStretch(1)

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
        """Persist numbering + tax + company; return company validation result.

        Numbering and tax are persisted first (no format validation gate);
        company is validated and saved only if valid. The result lets the caller
        show field-level messages.
        """
        self._controller.save_numbering_config(self.collect_numbering())
        self._controller.save_tax_config(self.collect_tax())
        result = self._controller.save_company(self.collect_company())
        if result.is_ok:
            self._current = self.collect_company()
        return result

    def set_logo(self, source_path: str) -> bool:
        """Import a logo asset; returns True on success, False if missing/unreadable."""
        asset = self._controller.import_asset(source_path, kind="logo")
        if asset is None:
            return False
        self._current = self._current.model_copy(update={"logo_asset_id": asset.id})
        self._controller.save_company(self._current)
        return True


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
