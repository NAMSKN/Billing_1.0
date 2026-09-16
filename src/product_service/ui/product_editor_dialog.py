"""Add / Edit Product dialog (product/service rules, sections 2-17).

A scrollable, sectioned, item-type-adaptive form over :class:`ProductController`.
Sections: Product Detail, Tax, Pricing, Manage Stock (Product only), Product
Group, and Additional Details (images, manufacturing, non-sellable, document
visibility). The form adapts to the selected item type: stock controls are
hidden for Service and Additional Charges (product/service rules, section 16).

Money, percentage, quantity and discount values are entered as text and parsed
to ``Decimal`` so no ``float`` ever touches a monetary value (coding standards,
DECISIONS D-004). The widget performs no SQL and no GST calculation
(DECISIONS D-021); tax defaults are stored, the engine calculates invoices.
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.ui.common.ui_kit import (
    StatusBanner,
    make_primary,
    scrollable,
    title_label,
)
from product_service.application.dto import ProductInput
from product_service.application.errors import (
    DuplicateProductError,
    ProductValidationError,
)
from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    Product,
    StockType,
)
from product_service.ui.product_controller import ProductController, ProductImageError


def _req(text: str) -> QLabel:
    """A required-field label with a red asterisk (matches the party editor)."""
    label = QLabel(f"{text} *")
    label.setObjectName("sectionTitle")
    return label


class ProductEditorDialog(QDialog):
    """Modal editor for creating or editing a product / service / charge."""

    def __init__(
        self,
        controller: ProductController,
        product: Product | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._controller = controller
        self._product = product
        self._image_asset_id: uuid.UUID | None = None
        self._saved_id: uuid.UUID | None = None
        self.setWindowTitle("Add Product" if product is None else "Edit Product")
        self.setMinimumSize(720, 620)

        self._build_widgets()
        self._build_layout()
        self._wire()
        self._load_groups()
        if product is not None:
            self._load_product(product)
        self._apply_item_type()

    # --- construction ---

    def _build_widgets(self) -> None:
        self.item_type = QComboBox()
        for it in (ItemType.PRODUCT, ItemType.SERVICE, ItemType.ADDITIONAL_CHARGES):
            self.item_type.addItem(it.label, userData=it.value)

        self.name = QLineEdit()
        self.note = QPlainTextEdit()
        self.note.setFixedHeight(60)
        self.barcode_no = QLineEdit()
        self.hsn_sac_code = QLineEdit()
        self.find_hsn_button = QPushButton("Find")
        # No offline lookup source exists; the button is a future extension
        # point and must not pretend to work (product/service rules, section 2).
        self.find_hsn_button.setEnabled(False)
        self.find_hsn_button.setToolTip("HSN/SAC lookup is not available offline.")
        self.unit_of_measurement = QLineEdit()

        # Tax.
        self.tax_rate = QLineEdit()
        self.tax_rate.setPlaceholderText("e.g. 18 (percent)")
        self.cess_percent = QLineEdit()
        self.cess_type = QComboBox()
        for ct in (CessType.FIXED, CessType.PER_UNIT):
            self.cess_type.addItem(ct.label, userData=ct.value)
        self.cess_amount = QLineEdit()
        self.no_itc = QCheckBox("This product is ineligible for Input credit")

        # Pricing.
        self.sell_price = QLineEdit()
        self.sell_price_incl_tax = QLineEdit()
        self.sale_discount_value = QLineEdit()
        self.sale_discount_type = self._discount_combo()
        self.purchase_price = QLineEdit()
        self.purchase_price_incl_tax = QLineEdit()
        self.purchase_discount_value = QLineEdit()
        self.purchase_discount_type = self._discount_combo()

        # Stock (Product only).
        self.stock_type = QComboBox()
        for st in (StockType.NORMAL, StockType.BATCH, StockType.SERIAL):
            self.stock_type.addItem(st.label, userData=st.value)
        self.opening_qty = QLineEdit()
        self.opening_qty.setPlaceholderText("Opening/initial quantity (optional)")
        self.low_stock_alert = QLineEdit()
        self.low_stock_alert.setPlaceholderText("Blank = no alert threshold")

        # Group.
        self.group = QComboBox()
        self.add_group_button = QPushButton("Add Product Group")

        # Image.
        self.image_preview = QLabel("No image")
        self.image_preview.setFixedSize(120, 120)
        self.image_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_preview.setObjectName("imagePreview")
        self.upload_image_button = QPushButton("Click To Upload")
        self.remove_image_button = QPushButton("Remove")

        # Flags.
        self.is_manufactured = QCheckBox("I Manufacture this product")
        self.non_sellable = QCheckBox("Enable (Non-Sellable Product)")
        self.visible_on_documents = QCheckBox("Product will be visible on all documents.")

        self.status = StatusBanner()
        self.buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        save_btn = self.buttons.button(QDialogButtonBox.StandardButton.Save)
        if save_btn is not None:
            make_primary(save_btn)

    def _discount_combo(self) -> QComboBox:
        combo = QComboBox()
        for dt in (DiscountType.RUPEE, DiscountType.PERCENTAGE):
            combo.addItem(dt.label, userData=dt.value)
        return combo

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        inner.addWidget(title_label("Product Detail"))
        inner.addWidget(self._detail_section())
        inner.addWidget(self._tax_section())
        self._pricing_box = self._pricing_section()
        inner.addWidget(self._pricing_box)
        self._stock_box = self._stock_section()
        inner.addWidget(self._stock_box)
        inner.addWidget(self._group_section())
        inner.addWidget(self._additional_section())

        outer = QVBoxLayout(self)
        outer.addWidget(scrollable(body), stretch=1)
        outer.addWidget(self.status)
        outer.addWidget(self.buttons)

    def _detail_section(self) -> QGroupBox:
        box = QGroupBox("Product Detail")
        form = QFormLayout(box)
        form.addRow("Item Type", self.item_type)
        form.addRow(_req("Name"), self.name)
        form.addRow("Product Note", self.note)
        form.addRow("Barcode No.", self.barcode_no)
        hsn_row = QHBoxLayout()
        hsn_row.addWidget(self.hsn_sac_code, stretch=1)
        hsn_row.addWidget(self.find_hsn_button)
        hsn_widget = QWidget()
        hsn_widget.setLayout(hsn_row)
        form.addRow("HSN/SAC Code", hsn_widget)
        self._unit_label = QLabel("Unit of Measurement")
        form.addRow(self._unit_label, self.unit_of_measurement)
        return box

    def _tax_section(self) -> QGroupBox:
        box = QGroupBox("Tax")
        form = QFormLayout(box)
        form.addRow(_req("Tax"), self.tax_rate)
        form.addRow("CESS %", self.cess_percent)
        form.addRow("CESS Type", self.cess_type)
        form.addRow("CESS Amount", self.cess_amount)
        form.addRow("No-ITC", self.no_itc)
        return box

    def _pricing_section(self) -> QGroupBox:
        box = QGroupBox("Pricing")
        form = QFormLayout(box)
        self._sell_label = QLabel("Sell Price")
        self._sell_incl_label = QLabel("Sell Price (Incl. Tax)")
        form.addRow(self._sell_label, self.sell_price)
        form.addRow(self._sell_incl_label, self.sell_price_incl_tax)
        form.addRow("Sale Discount", self.sale_discount_value)
        form.addRow("Sale Discount Type", self.sale_discount_type)
        form.addRow("Purchase Price", self.purchase_price)
        form.addRow("Purchase Price (Incl. Tax)", self.purchase_price_incl_tax)
        form.addRow("Purchase Discount", self.purchase_discount_value)
        form.addRow("Purchase Discount Type", self.purchase_discount_type)
        return box

    def _stock_section(self) -> QGroupBox:
        box = QGroupBox("Manage Stock")
        form = QFormLayout(box)
        form.addRow("Stock Type", self.stock_type)
        form.addRow("Available / Opening Qty", self.opening_qty)
        form.addRow("Low Stock Alert", self.low_stock_alert)
        return box

    def _group_section(self) -> QGroupBox:
        box = QGroupBox("Product Group")
        row = QHBoxLayout(box)
        row.addWidget(QLabel("Product Group"))
        row.addWidget(self.group, stretch=1)
        row.addWidget(self.add_group_button)
        return box

    def _additional_section(self) -> QGroupBox:
        box = QGroupBox("Additional Details")
        outer = QVBoxLayout(box)
        image_row = QHBoxLayout()
        image_row.addWidget(QLabel("Product Images"))
        image_row.addWidget(self.image_preview)
        image_buttons = QVBoxLayout()
        image_buttons.addWidget(self.upload_image_button)
        image_buttons.addWidget(self.remove_image_button)
        image_buttons.addStretch(1)
        image_row.addLayout(image_buttons)
        image_row.addStretch(1)
        outer.addLayout(image_row)
        outer.addWidget(self.is_manufactured)
        outer.addWidget(self.non_sellable)
        outer.addWidget(self.visible_on_documents)
        return box

    def _wire(self) -> None:
        self.item_type.currentIndexChanged.connect(self._apply_item_type)
        self.add_group_button.clicked.connect(self._on_add_group)
        self.upload_image_button.clicked.connect(self._on_upload_image)
        self.remove_image_button.clicked.connect(self._on_remove_image)
        self.buttons.accepted.connect(self._on_save)
        self.buttons.rejected.connect(self.reject)

    # --- behavior ---

    def _current_item_type(self) -> ItemType:
        return ItemType(self.item_type.currentData())

    def _apply_item_type(self) -> None:
        """Adapt the form to the selected item type (section 16).

        Stock controls appear only for a physical Product. Unit is required for
        a Product and optional otherwise.
        """
        item_type = self._current_item_type()
        is_product = item_type is ItemType.PRODUCT
        self._stock_box.setVisible(is_product)
        # Unit required only for Product.
        self._unit_label.setText("Unit of Measurement *" if is_product else "Unit of Measurement")

    def _load_groups(self, select_id: uuid.UUID | None = None) -> None:
        self.group.blockSignals(True)
        self.group.clear()
        self.group.addItem("-- No Group --", userData=None)
        for group in self._controller.list_groups():
            self.group.addItem(group.name, userData=str(group.id))
        if select_id is not None:
            idx = self.group.findData(str(select_id))
            if idx >= 0:
                self.group.setCurrentIndex(idx)
        self.group.blockSignals(False)

    def _on_add_group(self) -> None:
        name, ok = QInputDialog.getText(self, "Add Product Group", "Group name:")
        if not ok or not name.strip():
            return
        try:
            group = self._controller.create_group(name.strip())
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(str(exc))
            return
        self._load_groups(select_id=group.id)

    def _on_upload_image(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Select Product Image", "", "Images (*.png *.jpg *.jpeg *.gif *.webp)"
        )
        if not path:
            return
        # Show preview first so a corrupt image produces a clear error and does
        # not silently persist a broken reference.
        pixmap = QPixmap(path)
        if pixmap.isNull():
            self.status.show_error("That image could not be read. Choose a different file.")
            return
        try:
            asset_id = self._controller.import_image(path)
        except ProductImageError as exc:
            self.status.show_error(str(exc))
            return
        self._image_asset_id = asset_id
        self._set_preview(pixmap)
        self.status.show_ok("Image attached.")

    def _on_remove_image(self) -> None:
        self._image_asset_id = None
        self.image_preview.setPixmap(QPixmap())
        self.image_preview.setText("No image")
        self.status.show_info("Image removed.")

    def _set_preview(self, pixmap: QPixmap) -> None:
        scaled = pixmap.scaled(
            self.image_preview.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.image_preview.setPixmap(scaled)

    def _load_image_preview(self, asset_id: uuid.UUID) -> None:
        path = self._controller.image_path(asset_id)
        if not path:
            # Missing/dangling image reference must not break loading.
            self.image_preview.setText("Image unavailable")
            return
        pixmap = QPixmap(path)
        if pixmap.isNull():
            self.image_preview.setText("Image unavailable")
            return
        self._set_preview(pixmap)

    # --- load / collect ---

    def _load_product(self, product: Product) -> None:
        self._set_combo(self.item_type, product.item_type.value)
        self.name.setText(product.name)
        self.note.setPlainText(product.note)
        self.barcode_no.setText(product.barcode_no)
        self.hsn_sac_code.setText(product.hsn_sac_code)
        self.unit_of_measurement.setText(product.unit_of_measurement)

        self.tax_rate.setText(str(product.tax_rate))
        self.cess_percent.setText(str(product.cess_percent))
        self._set_combo(self.cess_type, product.cess_type.value)
        self.cess_amount.setText(str(product.cess_amount))
        self.no_itc.setChecked(product.no_itc)

        self.sell_price.setText(str(product.sell_price))
        self.sell_price_incl_tax.setText(str(product.sell_price_incl_tax))
        self.sale_discount_value.setText(str(product.sale_discount_value))
        self._set_combo(self.sale_discount_type, product.sale_discount_type.value)
        self.purchase_price.setText(str(product.purchase_price))
        self.purchase_price_incl_tax.setText(str(product.purchase_price_incl_tax))
        self.purchase_discount_value.setText(str(product.purchase_discount_value))
        self._set_combo(self.purchase_discount_type, product.purchase_discount_type.value)

        self._set_combo(self.stock_type, product.stock_type.value)
        if product.opening_qty is not None:
            self.opening_qty.setText(str(product.opening_qty))
        if product.low_stock_alert is not None:
            self.low_stock_alert.setText(str(product.low_stock_alert))

        if product.product_group_id is not None:
            self._load_groups(select_id=product.product_group_id)

        self.is_manufactured.setChecked(product.is_manufactured)
        self.non_sellable.setChecked(not product.is_sellable)
        self.visible_on_documents.setChecked(product.visible_on_documents)

        self._image_asset_id = product.image_asset_id
        if product.image_asset_id is not None:
            self._load_image_preview(product.image_asset_id)

    def _collect(self) -> ProductInput:
        item_type = self._current_item_type()
        group_data = self.group.currentData()
        group_id = uuid.UUID(str(group_data)) if group_data else None
        return ProductInput(
            name=self.name.text(),
            item_type=item_type,
            note=self.note.toPlainText(),
            barcode_no=self.barcode_no.text(),
            hsn_sac_code=self.hsn_sac_code.text(),
            unit_of_measurement=self.unit_of_measurement.text(),
            tax_rate=self._decimal(self.tax_rate.text()),
            cess_percent=self._decimal(self.cess_percent.text()),
            cess_type=CessType(self.cess_type.currentData()),
            cess_amount=self._decimal(self.cess_amount.text()),
            no_itc=self.no_itc.isChecked(),
            sell_price=self._decimal(self.sell_price.text()),
            sell_price_incl_tax=self._decimal(self.sell_price_incl_tax.text()),
            sale_discount_type=DiscountType(self.sale_discount_type.currentData()),
            sale_discount_value=self._decimal(self.sale_discount_value.text()),
            purchase_price=self._decimal(self.purchase_price.text()),
            purchase_price_incl_tax=self._decimal(self.purchase_price_incl_tax.text()),
            purchase_discount_type=DiscountType(self.purchase_discount_type.currentData()),
            purchase_discount_value=self._decimal(self.purchase_discount_value.text()),
            stock_type=StockType(self.stock_type.currentData()),
            opening_qty=self._decimal_opt(self.opening_qty.text()),
            low_stock_alert=self._decimal_opt(self.low_stock_alert.text()),
            product_group_id=group_id,
            image_asset_id=self._image_asset_id,
            is_manufactured=self.is_manufactured.isChecked(),
            is_sellable=not self.non_sellable.isChecked(),
            visible_on_documents=self.visible_on_documents.isChecked(),
        )

    def _on_save(self) -> None:
        try:
            data = self._collect()
        except InvalidOperation:
            self.status.show_error("Enter valid numbers for price, tax, and quantity fields.")
            return
        try:
            if self._product is None:
                saved = self._controller.create_product(data)
            else:
                saved = self._controller.update_product(
                    self._product.id, data, is_active=self._product.is_active
                )
        except ProductValidationError as exc:
            self.status.show_error("\n".join(exc.errors))
            return
        except DuplicateProductError as exc:
            self.status.show_error(str(exc))
            return
        except Exception as exc:  # noqa: BLE001 - boundary
            self.status.show_error(f"Could not save: {exc}")
            return
        self._saved_id = saved.id
        self.accept()

    # --- helpers ---

    @staticmethod
    def _decimal(text: str) -> Decimal:
        clean = text.strip()
        return Decimal("0") if not clean else Decimal(clean)

    @staticmethod
    def _decimal_opt(text: str) -> Decimal | None:
        clean = text.strip()
        return None if not clean else Decimal(clean)

    @staticmethod
    def _set_combo(combo: QComboBox, value: str) -> None:
        idx = combo.findData(value)
        if idx >= 0:
            combo.setCurrentIndex(idx)
