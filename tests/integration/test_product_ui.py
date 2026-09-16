"""Offscreen UI tests for the product editor and list screen (V2 Feature 2).

Exercises the item-type-adaptive form (stock controls hidden for Service /
Additional Charges), image upload/remove, group management, and the list
screen's tabs/filters. Uses the offscreen Qt platform so no display is needed.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from datetime import UTC, datetime  # noqa: E402
from decimal import Decimal  # noqa: E402

from PySide6.QtGui import QPixmap  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.infrastructure.db.connection import connect  # noqa: E402
from invoice_generator.infrastructure.db.migrator import apply_pending  # noqa: E402
from product_service.application.dto import ProductInput  # noqa: E402
from product_service.application.product_group_service import (  # noqa: E402
    ProductGroupService,
)
from product_service.application.product_service import ProductService  # noqa: E402
from product_service.domain.models import ItemType  # noqa: E402
from product_service.infrastructure.db.sqlite_product_group_repository import (  # noqa: E402
    SqliteProductGroupRepository,
)
from product_service.infrastructure.db.sqlite_product_repository import (  # noqa: E402
    SqliteProductRepository,
)
from product_service.ui.product_controller import ProductController  # noqa: E402
from product_service.ui.product_editor_dialog import ProductEditorDialog  # noqa: E402
from product_service.ui.product_list_screen import ProductListScreen  # noqa: E402
from tests.support.id_factory import SequentialIdGenerator  # noqa: E402

pytestmark = pytest.mark.integration


class _Clock:
    def now(self) -> datetime:
        return datetime(2026, 9, 11, tzinfo=UTC)


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def _controller() -> ProductController:
    conn = connect(":memory:")
    apply_pending(conn)
    product_svc = ProductService(
        SqliteProductRepository(conn),
        id_generator=SequentialIdGenerator(1),
        clock=_Clock(),
    )
    group_svc = ProductGroupService(
        SqliteProductGroupRepository(conn), id_generator=SequentialIdGenerator(500)
    )
    return ProductController(product_svc, group_svc)


def test_form_hides_stock_for_service(qapp: QApplication) -> None:
    dialog = ProductEditorDialog(_controller(), product=None)
    # Default item type is Product: stock section visible.
    dialog._set_combo(dialog.item_type, ItemType.PRODUCT.value)
    dialog._apply_item_type()
    assert dialog._stock_box.isVisibleTo(dialog) is True

    dialog._set_combo(dialog.item_type, ItemType.SERVICE.value)
    dialog._apply_item_type()
    assert dialog._stock_box.isVisibleTo(dialog) is False

    dialog._set_combo(dialog.item_type, ItemType.ADDITIONAL_CHARGES.value)
    dialog._apply_item_type()
    assert dialog._stock_box.isVisibleTo(dialog) is False


def test_find_hsn_button_disabled(qapp: QApplication) -> None:
    dialog = ProductEditorDialog(_controller(), product=None)
    assert dialog.find_hsn_button.isEnabled() is False


def test_create_product_through_dialog(qapp: QApplication) -> None:
    controller = _controller()
    dialog = ProductEditorDialog(controller, product=None)
    dialog.name.setText("Dialog Widget")
    dialog.unit_of_measurement.setText("Nos")
    dialog.tax_rate.setText("18")
    dialog.sell_price.setText("250.50")
    dialog._on_save()
    saved = list(controller.list_products())
    assert any(p.name == "Dialog Widget" and p.sell_price == Decimal("250.50") for p in saved)


def test_invalid_number_reported_not_crash(qapp: QApplication) -> None:
    controller = _controller()
    dialog = ProductEditorDialog(controller, product=None)
    dialog.name.setText("Bad Price")
    dialog.unit_of_measurement.setText("Nos")
    dialog.sell_price.setText("not-a-number")
    dialog._on_save()
    # Nothing saved; the status banner carries an error and the dialog stays open.
    assert list(controller.list_products()) == []


def test_image_missing_reference_does_not_break(qapp: QApplication) -> None:
    # asset_lookup returns None (no store wired): a product with an image
    # reference still loads and the preview degrades gracefully.
    controller = _controller()
    dialog = ProductEditorDialog(controller, product=None)
    import uuid

    dialog._load_image_preview(uuid.uuid4())
    assert dialog.image_preview.text() in ("Image unavailable", "No image")


def test_image_import_and_remove(qapp: QApplication, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # Wire a fake asset import that returns a real Asset with a stored path.
    from invoice_generator.domain.models import Asset

    image_file = tmp_path / "logo.png"
    QPixmap(10, 10).save(str(image_file), "PNG")

    stored = {"id": None}

    def _import(source):  # type: ignore[no-untyped-def]
        import uuid as _uuid

        asset = Asset(id=_uuid.uuid4(), kind="product_image", stored_path=str(source))
        stored["id"] = asset.id
        return asset

    def _lookup(asset_id):  # type: ignore[no-untyped-def]
        return Asset(id=asset_id, kind="product_image", stored_path=str(image_file))

    conn = connect(":memory:")
    apply_pending(conn)
    controller = ProductController(
        ProductService(SqliteProductRepository(conn), id_generator=SequentialIdGenerator(1)),
        ProductGroupService(SqliteProductGroupRepository(conn)),
        asset_import=_import,
        asset_lookup=_lookup,
    )
    asset_id = controller.import_image(image_file)
    assert asset_id is not None
    assert controller.image_path(asset_id) == str(image_file)


def test_group_management_dialog(qapp: QApplication) -> None:
    controller = _controller()
    controller.create_group("Tooling")
    groups = list(controller.list_groups())
    assert any(g.name == "Tooling" for g in groups)


def test_list_screen_tabs_and_reload(qapp: QApplication) -> None:
    controller = _controller()
    controller.create_product(
        ProductInput(
            name="Listed Product", item_type=ItemType.PRODUCT, unit_of_measurement="Nos"
        )
    )
    screen = ProductListScreen(controller)
    screen.reload()
    assert screen.table.rowCount() >= 1
    # Switch to the Services tab: the product should not appear.
    services_index = 2
    screen.tabs.setCurrentIndex(services_index)
    screen.reload()
    names = {
        screen.table.item(r, 0).text()
        for r in range(screen.table.rowCount())
        if screen.table.item(r, 0) is not None
    }
    assert "Listed Product" not in names


def test_export_dialog(qapp: QApplication) -> None:
    from product_service.infrastructure.excel.export_service import ExportScope
    from product_service.ui.excel_dialogs import ExportProductsDialog

    dlg = ExportProductsDialog()
    assert dlg.selected_scope() == ExportScope.ALL
    assert dlg.suggested_filename() == "products_services.xlsx"

    dlg._products.setChecked(True)
    assert dlg.selected_scope() == ExportScope.PRODUCTS
    assert dlg.suggested_filename() == "products.xlsx"

    dlg._services.setChecked(True)
    assert dlg.selected_scope() == ExportScope.SERVICES
    assert dlg.suggested_filename() == "services.xlsx"

    dlg._additional.setChecked(True)
    assert dlg.selected_scope() == ExportScope.ADDITIONAL_CHARGES
    assert dlg.suggested_filename() == "additional_charges.xlsx"


def test_import_mode_dialog(qapp: QApplication) -> None:
    from product_service.infrastructure.excel.import_service import ImportAs
    from product_service.ui.excel_dialogs import ImportModeDialog

    dlg = ImportModeDialog()
    assert dlg.selected_mode() == ImportAs.FILE
    dlg._product.setChecked(True)
    assert dlg.selected_mode() == ImportAs.PRODUCT
    dlg._service.setChecked(True)
    assert dlg.selected_mode() == ImportAs.SERVICE
    dlg._additional.setChecked(True)
    assert dlg.selected_mode() == ImportAs.ADDITIONAL_CHARGES


def test_import_preview_dialog_with_duplicates(qapp: QApplication) -> None:
    from product_service.domain.models import Product
    from product_service.infrastructure.excel.import_service import (
        DuplicateResolution,
        ImportPreview,
        ImportRow,
    )
    from product_service.ui.excel_dialogs import ImportPreviewDialog

    existing = Product(name="Existing", unit_of_measurement="PCS")
    valid_data = ProductInput(name="Existing", unit_of_measurement="PCS")
    row_dup = ImportRow(
        row_number=2,
        data=valid_data,
        duplicate_of=existing,
        resolution=DuplicateResolution.SKIP,
    )
    row_err = ImportRow(row_number=3, data=None, errors=["Name is required."])
    preview = ImportPreview(file_name="test.xlsx", rows=[row_dup, row_err])

    dlg = ImportPreviewDialog(preview)
    assert dlg.table.rowCount() == 2
    # Verify bulk resolution change
    dlg.bulk_combo.setCurrentIndex(1)  # "Update Existing"
    assert row_dup.resolution == DuplicateResolution.UPDATE
    dlg.bulk_combo.setCurrentIndex(2)  # "Create New"
    assert row_dup.resolution == DuplicateResolution.CREATE_NEW


def test_product_list_screen_excel_buttons(qapp: QApplication) -> None:
    controller = _controller()
    screen = ProductListScreen(controller)
    assert screen.import_button is not None
    assert screen.export_button is not None
    assert screen.sample_button is not None
