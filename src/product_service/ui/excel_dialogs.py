"""Modern light-theme Excel dialogs for Product / Service master."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QRadioButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import StatusBanner, make_primary, title_label
from product_service.infrastructure.excel.export_service import ExportScope
from product_service.infrastructure.excel.import_service import (
    DuplicateResolution,
    ImportAs,
    ImportPreview,
)


class ExportProductsDialog(QDialog):
    """Small modern dialog for choosing the export scope."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Export Products & Services")
        self.setMinimumWidth(380)

        layout = QVBoxLayout(self)
        layout.setSpacing(12)
        layout.addWidget(title_label("Export Products & Services"))

        prompt = QLabel("Export:")
        prompt.setObjectName("sectionTitle")
        layout.addWidget(prompt)

        self._products = QRadioButton("Products")
        self._services = QRadioButton("Services")
        self._additional = QRadioButton("Additional Charges")
        self._all = QRadioButton("All")
        self._all.setChecked(True)

        self._group = QButtonGroup(self)
        for btn in (self._products, self._services, self._additional, self._all):
            self._group.addButton(btn)
            layout.addWidget(btn)

        layout.addSpacing(8)

        buttons = QDialogButtonBox()
        self.export_btn = make_primary(
            buttons.addButton("Export", QDialogButtonBox.ButtonRole.AcceptRole)
        )
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def selected_scope(self) -> ExportScope:
        if self._products.isChecked():
            return ExportScope.PRODUCTS
        if self._services.isChecked():
            return ExportScope.SERVICES
        if self._additional.isChecked():
            return ExportScope.ADDITIONAL_CHARGES
        return ExportScope.ALL

    def suggested_filename(self) -> str:
        return {
            ExportScope.PRODUCTS: "products.xlsx",
            ExportScope.SERVICES: "services.xlsx",
            ExportScope.ADDITIONAL_CHARGES: "additional_charges.xlsx",
            ExportScope.ALL: "products_services.xlsx",
        }[self.selected_scope()]


class ImportModeDialog(QDialog):
    """Dialog for choosing whether to use ITEM TYPE from file or force an item type."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Import from Excel")
        self.setMinimumWidth(400)
        self.download_sample_requested = False

        layout = QVBoxLayout(self)
        layout.setSpacing(12)
        layout.addWidget(title_label("Import from Excel"))

        prompt = QLabel("Import as:")
        prompt.setObjectName("sectionTitle")
        layout.addWidget(prompt)

        self._file = QRadioButton("Use ITEM TYPE from file")
        self._product = QRadioButton("Products")
        self._service = QRadioButton("Services")
        self._additional = QRadioButton("Additional Charges")
        self._file.setChecked(True)

        self._group = QButtonGroup(self)
        for btn in (self._file, self._product, self._service, self._additional):
            self._group.addButton(btn)
            layout.addWidget(btn)

        layout.addSpacing(6)

        # Download sample helper
        sample_row = QHBoxLayout()
        self.sample_btn = QPushButton("Download Sample Excel")
        self.sample_btn.clicked.connect(self._on_download_sample)
        sample_row.addWidget(self.sample_btn)
        sample_row.addStretch(1)
        layout.addLayout(sample_row)

        layout.addSpacing(6)

        buttons = QDialogButtonBox()
        make_primary(
            buttons.addButton("Choose File\u2026", QDialogButtonBox.ButtonRole.AcceptRole)
        )
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_download_sample(self) -> None:
        self.download_sample_requested = True
        self.reject()

    def selected_mode(self) -> ImportAs:
        if self._product.isChecked():
            return ImportAs.PRODUCT
        if self._service.isChecked():
            return ImportAs.SERVICE
        if self._additional.isChecked():
            return ImportAs.ADDITIONAL_CHARGES
        return ImportAs.FILE


class _SummaryCard(QFrame):
    """Compact modern card showing a count and a label."""

    def __init__(
        self,
        count: int,
        label: str,
        *,
        accent_color: str | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        self.setFrameShape(QFrame.Shape.StyledPanel)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(2)

        self._value_label = QLabel(f"{count} {label}")
        self._value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        if accent_color:
            self._value_label.setStyleSheet(
                f"font-size: 13pt; font-weight: 800; color: {accent_color};"
            )
        else:
            self._value_label.setStyleSheet(
                "font-size: 13pt; font-weight: 800; color: #1a1a1a;"
            )

        layout.addWidget(self._value_label)


class ImportPreviewDialog(QDialog):
    """Displays parsed rows, validation errors, duplicate resolutions, and summary cards."""

    _COLUMNS = ("Status", "Row", "Name", "Type", "Issue", "Action")

    def __init__(self, preview: ImportPreview, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._preview = preview
        self._combos: list[tuple[int, QComboBox]] = []

        self.setWindowTitle("Import Preview")
        self.setMinimumSize(800, 520)

        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        # Header with Title and File Name
        top_row = QHBoxLayout()
        top_row.addWidget(title_label("Import Preview"))
        top_row.addStretch(1)
        if preview.file_name:
            file_lbl = QLabel(f"File: {preview.file_name}")
            file_lbl.setStyleSheet("font-size: 10pt; color: #555555; font-weight: 600;")
            top_row.addWidget(file_lbl)
        layout.addLayout(top_row)

        # Summary Cards: [25 Rows] [23 Valid] [2 Errors] (and Duplicates if any)
        cards_row = QHBoxLayout()
        cards_row.setSpacing(12)
        total_card = _SummaryCard(preview.total_rows, "Rows")
        valid_card = _SummaryCard(len(preview.valid_rows), "Valid", accent_color="#1a7f37")
        cards_row.addWidget(total_card)
        cards_row.addWidget(valid_card)

        if preview.error_rows:
            error_card = _SummaryCard(
                len(preview.error_rows), "Errors", accent_color="#c62828"
            )
            cards_row.addWidget(error_card)

        if preview.duplicate_rows:
            dup_card = _SummaryCard(
                len(preview.duplicate_rows), "Duplicates", accent_color="#8a6d00"
            )
            cards_row.addWidget(dup_card)

        cards_row.addStretch(1)
        layout.addLayout(cards_row)

        # Header errors banner if any
        if preview.has_header_errors:
            for err in preview.header_errors:
                lbl = QLabel(err)
                lbl.setObjectName("statusError")
                layout.addWidget(lbl)

        # Duplicate bulk selector toolbar if duplicates exist
        if preview.duplicate_rows:
            bulk_row = QHBoxLayout()
            bulk_lbl = QLabel("Action for all duplicates:")
            bulk_lbl.setStyleSheet("font-weight: 600;")
            bulk_row.addWidget(bulk_lbl)

            self.bulk_combo = QComboBox()
            self.bulk_combo.addItems(["Skip", "Update Existing", "Create New"])
            self.bulk_combo.setCurrentIndex(0)
            self.bulk_combo.currentIndexChanged.connect(self._on_bulk_resolution_changed)
            bulk_row.addWidget(self.bulk_combo)
            bulk_row.addStretch(1)
            layout.addLayout(bulk_row)

        # Table
        self.table = QTableWidget(len(preview.rows), len(self._COLUMNS))
        self.table.setHorizontalHeaderLabels(list(self._COLUMNS))
        self.table.horizontalHeader().setSectionResizeMode(
            4, QHeaderView.ResizeMode.Stretch
        )
        layout.addWidget(self.table, stretch=1)

        # Status banner
        self.status = StatusBanner()
        layout.addWidget(self.status)

        # Buttons
        buttons = QDialogButtonBox()
        self.commit_btn = make_primary(
            buttons.addButton("Import Valid Rows", QDialogButtonBox.ButtonRole.AcceptRole)
        )
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self._populate()
        self._update_status_and_buttons()

    def _populate(self) -> None:
        self.table.setRowCount(len(self._preview.rows))
        self._combos.clear()

        for row_idx, row in enumerate(self._preview.rows):
            name = row.data.name if row.data is not None else ""
            item_type = row.data.item_type.label if row.data is not None else ""

            if row.errors:
                status_text = "Error"
                issue_text = "; ".join(row.errors)
                action_text = "Skip"
            elif row.is_duplicate and row.duplicate_of is not None:
                status_text = "Duplicate"
                if row.data and row.data.barcode_no:
                    bcode = row.data.barcode_no
                    issue_text = f"Matches barcode '{bcode}' ({row.duplicate_of.name})"
                else:
                    issue_text = f"Matches name + type ({row.duplicate_of.name})"
                action_text = ""
            else:
                status_text = "Valid"
                issue_text = "Ready to import"
                action_text = "Create New"

            # Set cells
            item_status = QTableWidgetItem(status_text)
            if status_text == "Error":
                item_status.setForeground(Qt.GlobalColor.red)
            elif status_text == "Duplicate":
                item_status.setForeground(Qt.GlobalColor.darkYellow)
            else:
                item_status.setForeground(Qt.GlobalColor.darkGreen)

            self.table.setItem(row_idx, 0, item_status)
            self.table.setItem(row_idx, 1, QTableWidgetItem(str(row.row_number)))
            self.table.setItem(row_idx, 2, QTableWidgetItem(name))
            self.table.setItem(row_idx, 3, QTableWidgetItem(item_type))
            self.table.setItem(row_idx, 4, QTableWidgetItem(issue_text))

            if row.is_duplicate:
                combo = QComboBox()
                combo.addItems(["Skip", "Update Existing", "Create New"])
                if row.resolution is DuplicateResolution.UPDATE:
                    combo.setCurrentIndex(1)
                elif row.resolution is DuplicateResolution.CREATE_NEW:
                    combo.setCurrentIndex(2)
                else:
                    combo.setCurrentIndex(0)

                combo.currentIndexChanged.connect(
                    lambda _idx, r=row_idx, c=combo: self._on_row_resolution_changed(r, c)
                )
                self.table.setCellWidget(row_idx, 5, combo)
                self._combos.append((row_idx, combo))
            else:
                self.table.setItem(row_idx, 5, QTableWidgetItem(action_text))

        self.table.resizeColumnToContents(0)
        self.table.resizeColumnToContents(1)
        self.table.resizeColumnToContents(2)
        self.table.resizeColumnToContents(3)
        self.table.resizeColumnToContents(5)

    def _on_row_resolution_changed(self, row_idx: int, combo: QComboBox) -> None:
        choice = combo.currentText()
        row = self._preview.rows[row_idx]
        if choice == "Update Existing":
            row.resolution = DuplicateResolution.UPDATE
        elif choice == "Create New":
            row.resolution = DuplicateResolution.CREATE_NEW
        else:
            row.resolution = DuplicateResolution.SKIP
        self._update_status_and_buttons()

    def _on_bulk_resolution_changed(self, index: int) -> None:
        choice = self.bulk_combo.currentText()
        res = {
            "Skip": DuplicateResolution.SKIP,
            "Update Existing": DuplicateResolution.UPDATE,
            "Create New": DuplicateResolution.CREATE_NEW,
        }[choice]

        for row_idx, combo in self._combos:
            combo.blockSignals(True)
            combo.setCurrentIndex(index)
            combo.blockSignals(False)
            self._preview.rows[row_idx].resolution = res

        self._update_status_and_buttons()

    def _update_status_and_buttons(self) -> None:
        error_count = len(self._preview.error_rows)

        # Count how many valid rows will actually be imported (created or updated)
        import_count = 0
        skipped_dup_count = 0
        for r in self._preview.valid_rows:
            if r.is_duplicate and r.resolution is DuplicateResolution.SKIP:
                skipped_dup_count += 1
            else:
                import_count += 1

        parts: list[str] = [f"{import_count} row(s) will be imported."]
        skipped_parts: list[str] = []
        if error_count:
            skipped_parts.append(f"{error_count} error row(s)")
        if skipped_dup_count:
            skipped_parts.append(f"{skipped_dup_count} duplicate row(s)")

        if skipped_parts:
            parts.append(f"{' and '.join(skipped_parts)} will be skipped.")

        summary_msg = " ".join(parts)

        if error_count > 0:
            self.status.show_error(summary_msg)
        elif skipped_dup_count > 0:
            self.status.show_info(summary_msg)
        else:
            self.status.show_ok(summary_msg)

        has_importable = import_count > 0 and not self._preview.has_header_errors
        self.commit_btn.setEnabled(has_importable)
        self.commit_btn.setText(
            "Import Valid Rows" if has_importable else "Nothing to Import"
        )

    @property
    def preview(self) -> ImportPreview:
        return self._preview
