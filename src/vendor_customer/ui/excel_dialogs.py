"""Excel export / import dialogs for the party master (product rules, 15-18)."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QButtonGroup,
    QDialog,
    QDialogButtonBox,
    QLabel,
    QRadioButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary, title_label
from vendor_customer.infrastructure.excel.export_service import ExportScope
from vendor_customer.infrastructure.excel.import_service import (
    ImportAs,
    ImportPreview,
)


class ExportScopeDialog(QDialog):
    """Asks the user which parties to export before any file is written."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Export to Excel")
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Export"))

        self._customers = QRadioButton("Export Customers")
        self._vendors = QRadioButton("Export Vendors")
        self._both = QRadioButton("Export Customers & Vendors")
        self._customers.setChecked(True)

        self._group = QButtonGroup(self)
        for btn in (self._customers, self._vendors, self._both):
            self._group.addButton(btn)
            layout.addWidget(btn)

        buttons = QDialogButtonBox()
        make_primary(buttons.addButton("Continue", QDialogButtonBox.ButtonRole.AcceptRole))
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def selected_scope(self) -> ExportScope:
        if self._vendors.isChecked():
            return ExportScope.VENDORS
        if self._both.isChecked():
            return ExportScope.BOTH
        return ExportScope.CUSTOMERS

    def suggested_filename(self) -> str:
        return {
            ExportScope.CUSTOMERS: "customers.xlsx",
            ExportScope.VENDORS: "vendors.xlsx",
            ExportScope.BOTH: "customers_vendors.xlsx",
        }[self.selected_scope()]


class ImportModeDialog(QDialog):
    """Asks how to import (preserve file type, or force one) before parsing."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Import from Excel")
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Import As"))

        self._file = QRadioButton("Use Company Type from file")
        self._customer = QRadioButton("Customer")
        self._vendor = QRadioButton("Vendor")
        self._both = QRadioButton("Customer / Vendor")
        self._file.setChecked(True)

        self._group = QButtonGroup(self)
        for btn in (self._file, self._customer, self._vendor, self._both):
            self._group.addButton(btn)
            layout.addWidget(btn)

        buttons = QDialogButtonBox()
        make_primary(buttons.addButton("Choose File\u2026", QDialogButtonBox.ButtonRole.AcceptRole))
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def selected_mode(self) -> ImportAs:
        if self._customer.isChecked():
            return ImportAs.CUSTOMER
        if self._vendor.isChecked():
            return ImportAs.VENDOR
        if self._both.isChecked():
            return ImportAs.CUSTOMER_VENDOR
        return ImportAs.FILE


class ImportPreviewDialog(QDialog):
    """Shows parsed rows, row-level errors, and duplicates before commit."""

    _COLUMNS = ("Row", "Company Name", "Type", "Status")

    def __init__(self, preview: ImportPreview, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._preview = preview
        self.setWindowTitle("Import Preview")
        self.setMinimumSize(640, 480)

        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Import Preview"))

        self.status = StatusBanner()
        layout.addWidget(self.status)

        if preview.has_header_errors:
            for err in preview.header_errors:
                lbl = QLabel(err)
                lbl.setObjectName("statusError")
                layout.addWidget(lbl)

        self.table = QTableWidget(len(preview.rows), len(self._COLUMNS))
        self.table.setHorizontalHeaderLabels(list(self._COLUMNS))
        self._populate(preview)
        layout.addWidget(self.table, stretch=1)

        summary = (
            f"{len(preview.valid_rows)} valid, "
            f"{len(preview.error_rows)} with errors, "
            f"{len(preview.duplicate_rows)} duplicate(s)."
        )
        if preview.error_rows:
            self.status.show_error(summary + " Rows with errors will not be imported.")
        else:
            self.status.show_ok(summary)

        buttons = QDialogButtonBox()
        commit_label = "Import Valid Rows" if preview.valid_rows else "Nothing to Import"
        commit_btn = make_primary(
            buttons.addButton(commit_label, QDialogButtonBox.ButtonRole.AcceptRole)
        )
        commit_btn.setEnabled(bool(preview.valid_rows) and not preview.has_header_errors)
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _populate(self, preview: ImportPreview) -> None:
        for row_idx, row in enumerate(preview.rows):
            name = row.data.company_name if row.data is not None else ""
            ptype = row.data.company_type.label if row.data is not None else ""
            if row.errors:
                status = "ERROR: " + "; ".join(row.errors)
            elif row.is_duplicate and row.duplicate_of is not None:
                status = f"Duplicate of {row.duplicate_of.company_name} (will skip)"
            else:
                status = "New"
            for col, value in enumerate((str(row.row_number), name, ptype, status)):
                item = QTableWidgetItem(value)
                item.setToolTip(value)
                self.table.setItem(row_idx, col, item)
        self.table.resizeColumnsToContents()

    @property
    def preview(self) -> ImportPreview:
        return self._preview
