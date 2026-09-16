"""Product Master list screen (product/service rules, sections 18-20).

A table of products with type tabs (All / Products / Services / Additional
Charges), a DB-backed search box (name, barcode, HSN/SAC), Active/Archived and
Sellable/Non-Sellable filters, a product-group filter, and Open / Edit /
Archive actions plus Add and Manage Groups. Import/Export is deferred (see the
feature docs). The widget performs no SQL and no business rules
(DECISIONS D-021); everything goes through :class:`ProductController`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import (
    StatusBanner,
    make_danger,
    make_primary,
    title_label,
)
from product_service.domain.models import ItemType, Product
from product_service.ui.excel_dialogs import (
    ExportProductsDialog,
    ImportModeDialog,
    ImportPreviewDialog,
)
from product_service.ui.product_controller import ProductController
from product_service.ui.product_editor_dialog import ProductEditorDialog
from product_service.ui.product_group_dialog import ProductGroupDialog

_COLUMNS = (
    "Name",
    "Type",
    "HSN/SAC",
    "Unit",
    "Sell Price",
    "Purchase Price",
    "Tax",
    "Stock Type",
    "Available Qty",
    "Group",
    "Status",
)

_TABS: tuple[tuple[str, ItemType | None], ...] = (
    ("All", None),
    ("Products", ItemType.PRODUCT),
    ("Services", ItemType.SERVICE),
    ("Additional Charges", ItemType.ADDITIONAL_CHARGES),
)

_STATUS_FILTERS = ("Active", "Archived", "All")
_SELLABLE_FILTERS = ("All", "Sellable", "Non-Sellable")


class ProductListScreen(QWidget):
    """Screen for browsing and managing products / services / charges."""

    def __init__(self, controller: ProductController) -> None:
        super().__init__()
        self._controller = controller
        self._rows: list[Product] = []

        self._build_widgets()
        self._build_layout()
        self._wire()
        self.reload()

    def _build_widgets(self) -> None:
        self.tabs = QComboBox()
        self.tabs.addItems([label for label, _ in _TABS])

        self.search = QLineEdit()
        self.search.setPlaceholderText("Search name, barcode, or HSN/SAC")

        self.status_filter = QComboBox()
        self.status_filter.addItems(list(_STATUS_FILTERS))
        self.sellable_filter = QComboBox()
        self.sellable_filter.addItems(list(_SELLABLE_FILTERS))
        self.group_filter = QComboBox()

        self.add_button = make_primary(QPushButton("+ Add Product"))
        self.groups_button = QPushButton("Manage Groups")
        self.import_button = QPushButton("Import Excel")
        self.export_button = QPushButton("Export Excel")
        self.sample_button = QPushButton("Download Sample Excel")

        self.open_button = QPushButton("Open")
        self.edit_button = QPushButton("Edit")
        self.archive_button = make_danger(QPushButton("Archive"))

        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)

        self.status = StatusBanner()

    def _build_layout(self) -> None:
        layout = QVBoxLayout(self)
        layout.addWidget(title_label("Product Master"))

        toolbar = QHBoxLayout()
        toolbar.addWidget(self.tabs)
        toolbar.addWidget(self.search, stretch=1)
        toolbar.addWidget(self.add_button)
        toolbar.addWidget(self.groups_button)
        toolbar.addWidget(self.import_button)
        toolbar.addWidget(self.export_button)
        toolbar.addWidget(self.sample_button)
        layout.addLayout(toolbar)

        filters = QHBoxLayout()
        filters.addWidget(self.status_filter)
        filters.addWidget(self.sellable_filter)
        filters.addWidget(self.group_filter, stretch=1)
        layout.addLayout(filters)

        layout.addWidget(self.table, stretch=1)

        actions = QHBoxLayout()
        actions.addWidget(self.open_button)
        actions.addWidget(self.edit_button)
        actions.addWidget(self.archive_button)
        actions.addStretch(1)
        layout.addLayout(actions)

        layout.addWidget(self.status)

    def _wire(self) -> None:
        self.tabs.currentIndexChanged.connect(self.reload)
        self.search.textChanged.connect(self.reload)
        self.status_filter.currentIndexChanged.connect(self.reload)
        self.sellable_filter.currentIndexChanged.connect(self.reload)
        self.group_filter.currentIndexChanged.connect(self.reload)
        self.add_button.clicked.connect(self._on_add)
        self.groups_button.clicked.connect(self._on_manage_groups)
        self.import_button.clicked.connect(self._on_import)
        self.export_button.clicked.connect(self._on_export)
        self.sample_button.clicked.connect(self._on_download_sample)
        self.open_button.clicked.connect(lambda: self._open_selected(edit=False))
        self.edit_button.clicked.connect(lambda: self._open_selected(edit=True))
        self.archive_button.clicked.connect(self._on_archive)
        self.table.doubleClicked.connect(lambda _idx: self._open_selected(edit=True))

    # --- data ---

    def _current_type(self) -> ItemType | None:
        return _TABS[self.tabs.currentIndex()][1]

    def _reload_groups(self) -> None:
        current = self.group_filter.currentData()
        self.group_filter.blockSignals(True)
        self.group_filter.clear()
        self.group_filter.addItem("All Groups", userData=None)
        for group in self._controller.list_groups():
            self.group_filter.addItem(group.name, userData=str(group.id))
        if current:
            idx = self.group_filter.findData(current)
            if idx >= 0:
                self.group_filter.setCurrentIndex(idx)
        self.group_filter.blockSignals(False)

    def reload(self) -> None:
        self._reload_groups()
        term = self.search.text().strip()
        item_type = self._current_type()
        status = self.status_filter.currentText()
        include_archived = status in ("Archived", "All")

        if term:
            rows = self._controller.search_products(
                term, item_type=item_type, include_archived=include_archived
            )
        else:
            rows = self._controller.list_products(
                item_type=item_type, include_archived=include_archived
            )

        rows = self._apply_client_filters(rows, status)
        self._rows = list(rows)
        self._fill_table(self._rows)
        if not self._rows:
            self.status.show_info("No matching products.")
        else:
            self.status.show_info(f"{len(self._rows)} record(s).")

    def _apply_client_filters(
        self, rows: Sequence[Product], status: str
    ) -> list[Product]:
        result = list(rows)
        if status == "Active":
            result = [p for p in result if p.is_active]
        elif status == "Archived":
            result = [p for p in result if not p.is_active]

        sellable = self.sellable_filter.currentText()
        if sellable == "Sellable":
            result = [p for p in result if p.is_sellable]
        elif sellable == "Non-Sellable":
            result = [p for p in result if not p.is_sellable]

        group_data = self.group_filter.currentData()
        if group_data:
            group_id = uuid.UUID(str(group_data))
            result = [p for p in result if p.product_group_id == group_id]
        return result

    def _fill_table(self, products: Sequence[Product]) -> None:
        self.table.setRowCount(len(products))
        for row_idx, p in enumerate(products):
            stock_type = p.stock_type.label if p.tracks_stock else "\u2014"
            has_qty = p.tracks_stock and p.opening_qty is not None
            available = str(p.opening_qty) if has_qty else "\u2014"
            values = (
                p.name,
                p.item_type.label,
                p.hsn_sac_code,
                p.unit_of_measurement,
                f"\u20b9{p.sell_price}",
                f"\u20b9{p.purchase_price}",
                f"{p.tax_rate}%",
                stock_type,
                available,
                self._controller.group_name(p.product_group_id),
                self._status_text(p),
            )
            for col, value in enumerate(values):
                item = QTableWidgetItem(value or "\u2014")
                item.setToolTip(value or "")
                if col == 0:
                    item.setData(Qt.ItemDataRole.UserRole, str(p.id))
                self.table.setItem(row_idx, col, item)

    @staticmethod
    def _status_text(p: Product) -> str:
        if not p.is_active:
            return "Archived"
        return "Active" if p.is_sellable else "Non-Sellable"

    def _selected_product(self) -> Product | None:
        row = self.table.currentRow()
        if 0 <= row < len(self._rows):
            return self._rows[row]
        return None

    # --- actions ---

    def _on_add(self) -> None:
        dialog = ProductEditorDialog(self._controller, product=None, parent=self)
        if dialog.exec() == int(QMessageBox.DialogCode.Accepted):
            self.reload()
            self.status.show_ok("Product saved.")

    def _open_selected(self, *, edit: bool) -> None:
        product = self._selected_product()
        if product is None:
            self.status.show_info("Select a record first.")
            return
        dialog = ProductEditorDialog(self._controller, product=product, parent=self)
        if dialog.exec() == int(QMessageBox.DialogCode.Accepted):
            self.reload()
            self.status.show_ok("Product updated.")

    def _on_archive(self) -> None:
        product = self._selected_product()
        if product is None:
            self.status.show_info("Select a record first.")
            return
        confirm = QMessageBox.question(
            self,
            "Archive",
            f"Archive '{product.name}'? It will be hidden from new documents "
            "but kept for historical records.",
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        self._controller.archive_product(product.id)
        self.reload()
        self.status.show_ok(f"Archived '{product.name}'.")

    def _on_manage_groups(self) -> None:
        dialog = ProductGroupDialog(self._controller, self)
        dialog.exec()
        self.reload()

    def _on_export(self) -> None:
        dialog = ExportProductsDialog(self)
        if dialog.exec() != int(QMessageBox.DialogCode.Accepted):
            return
        scope = dialog.selected_scope()
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export to Excel",
            dialog.suggested_filename(),
            "Excel (*.xlsx)",
        )
        if not path:
            return
        try:
            written = self._controller.export(
                scope,
                path,
                include_archived=self.status_filter.currentText() in ("Archived", "All"),
                overwrite=True,
            )
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Export failed: {exc}")
            return
        self.status.show_ok(f"Exported to {written}")

    def _on_import(self) -> None:
        mode_dialog = ImportModeDialog(self)
        code = mode_dialog.exec()
        if mode_dialog.download_sample_requested:
            self._on_download_sample()
            return
        if code != int(QMessageBox.DialogCode.Accepted):
            return

        import_as = mode_dialog.selected_mode()
        path, _ = QFileDialog.getOpenFileName(
            self, "Import from Excel", "", "Excel (*.xlsx)"
        )
        if not path:
            return

        try:
            preview = self._controller.build_import_preview(path, import_as=import_as)
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Could not read file: {exc}")
            return

        preview_dialog = ImportPreviewDialog(preview, self)
        if preview_dialog.exec() != int(QMessageBox.DialogCode.Accepted):
            self.status.show_info("Import cancelled. No data was changed.")
            return

        try:
            result = self._controller.commit_import(preview)
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Import failed: {exc}")
            return

        self.reload()
        self.status.show_ok(
            f"Imported: {result.created} created, {result.updated} updated, "
            f"{result.skipped} skipped."
        )

    def _on_download_sample(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Download Sample Excel",
            "product_service_sample.xlsx",
            "Excel (*.xlsx)",
        )
        if not path:
            return
        try:
            written = self._controller.download_sample(path, overwrite=True)
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Could not save sample: {exc}")
            return
        self.status.show_ok(f"Sample Excel saved to {written}")

    def selected_id(self) -> uuid.UUID | None:
        product = self._selected_product()
        return product.id if product is not None else None
