"""Excel export / import tests for the Product / Service master (V2 Feature 2A).

Tests all 23 application-level scenarios specified in the feature requirements:
 1. Export Products
 2. Export Services
 3. Export Additional Charges
 4. Export All
 5. Export does not duplicate records
 6. Import Product
 7. Import Service
 8. Import Additional Charges
 9. Import using ITEM TYPE
10. Import validation errors
11. Missing required Name
12. Invalid Item Type
13. Invalid numeric values
14. Blank optional fields accepted
15. Service with blank stock fields accepted
16. Additional Charges with blank stock fields accepted
17. Duplicate detection
18. Update existing
19. Skip duplicate
20. Create new duplicate
21. Cancel import does not modify database
22. Successful import persists after restart
23. Exported file can be imported again
Plus transaction rollback and sample template validation.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from product_service.application.dto import CreateProductCommand, ProductInput
from product_service.application.product_group_service import ProductGroupService
from product_service.application.product_service import ProductService
from product_service.domain.models import (
    CessType,
    DiscountType,
    ItemType,
    StockType,
)
from product_service.infrastructure.db.sqlite_product_group_repository import (
    SqliteProductGroupRepository,
)
from product_service.infrastructure.db.sqlite_product_repository import (
    SqliteProductRepository,
)
from product_service.infrastructure.excel import columns as C
from product_service.infrastructure.excel.export_service import (
    ExportScope,
    ProductExcelExporter,
    select_for_scope,
)
from product_service.infrastructure.excel.import_service import (
    DuplicateResolution,
    ImportAs,
    ProductExcelImporter,
)
from product_service.infrastructure.excel.sample_template import write_sample_excel
from tests.support.id_factory import SequentialIdGenerator


class _TestClock:
    def now(self) -> datetime:
        return datetime(2026, 9, 12, tzinfo=UTC)


@pytest.fixture()
def conn() -> sqlite3.Connection:
    c = connect(":memory:")
    apply_pending(c)
    return c


@pytest.fixture()
def group_service(conn: sqlite3.Connection) -> ProductGroupService:
    repo = SqliteProductGroupRepository(conn)
    return ProductGroupService(repo, id_generator=SequentialIdGenerator(100))


@pytest.fixture()
def service(conn: sqlite3.Connection) -> ProductService:
    repo = SqliteProductRepository(conn)
    return ProductService(repo, id_generator=SequentialIdGenerator(1), clock=_TestClock())


def _seed_items(service: ProductService, group_service: ProductGroupService) -> None:
    grp = group_service.create_group("Standard Moulds")

    # 1. Product
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Mould Base A",
                item_type=ItemType.PRODUCT,
                note="High precision steel",
                barcode_no="BAR-PRD-1",
                hsn_sac_code="8480",
                unit_of_measurement="PCS",
                tax_rate=Decimal("18"),
                cess_percent=Decimal("0"),
                cess_type=CessType.FIXED,
                cess_amount=Decimal("0"),
                no_itc=False,
                sell_price=Decimal("15000"),
                sell_price_incl_tax=Decimal("17700"),
                sale_discount_type=DiscountType.RUPEE,
                sale_discount_value=Decimal("500"),
                purchase_price=Decimal("10000"),
                purchase_price_incl_tax=Decimal("11800"),
                purchase_discount_type=DiscountType.PERCENTAGE,
                purchase_discount_value=Decimal("5"),
                stock_type=StockType.NORMAL,
                opening_qty=Decimal("10"),
                low_stock_alert=Decimal("2"),
                product_group_id=grp.id,
                is_manufactured=True,
                is_sellable=True,
                visible_on_documents=True,
            )
        )
    )

    # 2. Service
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="CNC Milling Service",
                item_type=ItemType.SERVICE,
                note="Per hour milling charge",
                barcode_no="BAR-SRV-1",
                hsn_sac_code="9988",
                unit_of_measurement="HRS",
                tax_rate=Decimal("18"),
                sell_price=Decimal("800"),
                sell_price_incl_tax=Decimal("944"),
                purchase_price=Decimal("500"),
                purchase_price_incl_tax=Decimal("590"),
                is_sellable=True,
            )
        )
    )

    # 3. Additional Charges
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Freight & Transport",
                item_type=ItemType.ADDITIONAL_CHARGES,
                note="Standard logistics",
                hsn_sac_code="9965",
                tax_rate=Decimal("5"),
                sell_price=Decimal("1200"),
                sell_price_incl_tax=Decimal("1260"),
                purchase_price=Decimal("1000"),
                purchase_price_incl_tax=Decimal("1050"),
                is_sellable=True,
            )
        )
    )


def _write_xlsx(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for r in rows:
        sheet.append(r)
    wb.save(str(path))


# =========================================================================
# 1. Export Products
# =========================================================================


def test_01_export_products(
    service: ProductService, group_service: ProductGroupService, tmp_path: Path
) -> None:
    _seed_items(service, group_service)
    exporter = ProductExcelExporter(
        group_name_resolver=lambda gid: group_service.get_group(gid).name
        if gid and group_service.get_group(gid)
        else ""
    )
    out_path = tmp_path / "products.xlsx"
    exporter.export(service.list_products(), ExportScope.PRODUCTS, out_path)

    wb = load_workbook(out_path)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))

    header = list(rows[0])
    assert header == list(C.EXPORT_COLUMNS)
    # Sheet has 1 data row (Products only)
    assert len(rows) == 2
    data_row = rows[1]
    assert data_row[header.index(C.COL_ITEM_TYPE)] == "Product"
    assert data_row[header.index(C.COL_NAME)] == "Mould Base A"
    assert data_row[header.index(C.COL_BARCODE)] == "BAR-PRD-1"
    assert data_row[header.index(C.COL_UOM)] == "PCS"
    assert data_row[header.index(C.COL_PRODUCT_GROUP)] == "Standard Moulds"
    assert data_row[header.index(C.COL_AVAILABLE_QTY)] == Decimal("10")


# =========================================================================
# 2. Export Services
# =========================================================================


def test_02_export_services(
    service: ProductService, group_service: ProductGroupService, tmp_path: Path
) -> None:
    _seed_items(service, group_service)
    exporter = ProductExcelExporter()
    out_path = tmp_path / "services.xlsx"
    exporter.export(service.list_products(), ExportScope.SERVICES, out_path)

    wb = load_workbook(out_path)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))

    assert len(rows) == 2
    header = list(rows[0])
    data_row = rows[1]
    assert data_row[header.index(C.COL_ITEM_TYPE)] == "Service"
    assert data_row[header.index(C.COL_NAME)] == "CNC Milling Service"
    # Service irrelevant stock fields must remain blank
    assert data_row[header.index(C.COL_STOCK_TYPE)] in ("", None)
    assert data_row[header.index(C.COL_AVAILABLE_QTY)] in ("", None)
    assert data_row[header.index(C.COL_LOW_STOCK_ALERT)] in ("", None)


# =========================================================================
# 3. Export Additional Charges
# =========================================================================


def test_03_export_additional_charges(
    service: ProductService, group_service: ProductGroupService, tmp_path: Path
) -> None:
    _seed_items(service, group_service)
    exporter = ProductExcelExporter()
    out_path = tmp_path / "additional_charges.xlsx"
    exporter.export(service.list_products(), ExportScope.ADDITIONAL_CHARGES, out_path)

    wb = load_workbook(out_path)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))

    assert len(rows) == 2
    header = list(rows[0])
    data_row = rows[1]
    assert data_row[header.index(C.COL_ITEM_TYPE)] == "Additional Charges"
    assert data_row[header.index(C.COL_NAME)] == "Freight & Transport"
    # Additional charges irrelevant stock fields must remain blank
    assert data_row[header.index(C.COL_STOCK_TYPE)] in ("", None)
    assert data_row[header.index(C.COL_AVAILABLE_QTY)] in ("", None)


# =========================================================================
# 4. Export All
# =========================================================================


def test_04_export_all(
    service: ProductService, group_service: ProductGroupService, tmp_path: Path
) -> None:
    _seed_items(service, group_service)
    exporter = ProductExcelExporter()
    out_path = tmp_path / "products_services.xlsx"
    exporter.export(service.list_products(), ExportScope.ALL, out_path)

    wb = load_workbook(out_path)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))

    # Header + 3 records
    assert len(rows) == 4
    header = rows[0]
    names = [r[header.index(C.COL_NAME)] for r in rows[1:]]
    assert sorted(names) == [
        "CNC Milling Service",
        "Freight & Transport",
        "Mould Base A",
    ]


# =========================================================================
# 5. Export does not duplicate records
# =========================================================================


def test_05_export_does_not_duplicate_records(
    service: ProductService, group_service: ProductGroupService
) -> None:
    _seed_items(service, group_service)
    all_prods = list(service.list_products())
    # If the list has duplicated instances, select_for_scope should deduplicate by id
    duplicated_list = all_prods + all_prods
    selected = select_for_scope(duplicated_list, ExportScope.ALL)
    assert len(selected) == len(all_prods)


# =========================================================================
# 6. Import Product
# =========================================================================


def test_06_import_product(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "imp_prd.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_SELL_PRICE],
        [["Drill Bit 10mm", "Product", "NOS", "450.00"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert not preview.has_header_errors
    assert len(preview.valid_rows) == 1
    assert preview.valid_rows[0].data is not None
    assert preview.valid_rows[0].data.item_type is ItemType.PRODUCT
    assert preview.valid_rows[0].data.unit_of_measurement == "NOS"
    assert preview.valid_rows[0].data.sell_price == Decimal("450.00")

    result = importer.commit(preview)
    assert result.created == 1
    saved = service.search_products("Drill Bit 10mm")
    assert len(saved) == 1
    assert saved[0].name == "Drill Bit 10mm"


# =========================================================================
# 7. Import Service
# =========================================================================


def test_07_import_service(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "imp_srv.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_TAX, C.COL_SELL_PRICE],
        [["Surface Grinding", "Service", "18", "1200"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert not preview.has_header_errors
    assert len(preview.valid_rows) == 1
    result = importer.commit(preview)
    assert result.created == 1

    saved = service.search_products("Surface Grinding")
    assert len(saved) == 1
    assert saved[0].item_type is ItemType.SERVICE
    assert saved[0].tax_rate == Decimal("18")
    assert saved[0].opening_qty is None


# =========================================================================
# 8. Import Additional Charges
# =========================================================================


def test_08_import_additional_charges(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "imp_chg.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_SELL_PRICE],
        [["Handling & Packing", "Additional Charges", "350"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert not preview.has_header_errors
    assert len(preview.valid_rows) == 1
    result = importer.commit(preview)
    assert result.created == 1

    saved = service.search_products("Handling & Packing")
    assert len(saved) == 1
    assert saved[0].item_type is ItemType.ADDITIONAL_CHARGES


# =========================================================================
# 9. Import using ITEM TYPE
# =========================================================================


def test_09_import_using_item_type(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "imp_types.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM],
        [
            ["Item A", "Product", "PCS"],
            ["Item B", "Service", ""],
            ["Item C", "Additional Charges", ""],
        ],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path, import_as=ImportAs.FILE)
    assert len(preview.valid_rows) == 3
    types = [r.data.item_type for r in preview.valid_rows if r.data]
    assert types == [
        ItemType.PRODUCT,
        ItemType.SERVICE,
        ItemType.ADDITIONAL_CHARGES,
    ]


# =========================================================================
# 10. Import validation errors
# =========================================================================


def test_10_import_validation_errors(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "errs.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_TAX, C.COL_SALE_DISCOUNT],
        [
            ["", "Product", "PCS", "18", "0"],  # Row 2: Name missing
            ["Bad Type Item", "AlienType", "PCS", "18", "0"],  # Row 3: Invalid item type
            ["Negative Tax Item", "Service", "", "-5", "0"],  # Row 4: Invalid tax
            ["Negative Discount Item", "Service", "", "18", "-50"],  # Row 5: Invalid discount
        ],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.error_rows) == 4
    assert any("Name is required" in e for e in preview.rows[0].errors)
    assert any("Invalid Item Type" in e for e in preview.rows[1].errors)
    assert any("Tax rate cannot be negative" in e for e in preview.rows[2].errors)
    assert any("Sale Discount cannot be negative" in e for e in preview.rows[3].errors)

    # Malformed rows are never persisted
    result = importer.commit(preview)
    assert result.created == 0


# =========================================================================
# 11. Missing required Name
# =========================================================================


def test_11_missing_required_name(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "noname.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM],
        [["   ", "Product", "PCS"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.error_rows) == 1
    assert "Name is required." in preview.rows[0].errors


# =========================================================================
# 12. Invalid Item Type
# =========================================================================


def test_12_invalid_item_type(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "bad_type.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM],
        [["Item X", "Gadget", "PCS"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.error_rows) == 1
    assert any("Invalid Item Type" in e for e in preview.rows[0].errors)


# =========================================================================
# 13. Invalid numeric values
# =========================================================================


def test_13_invalid_numeric_values(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "bad_nums.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_SELL_PRICE, C.COL_CESS_AMOUNT],
        [["Item Y", "Service", "not_a_number", "-100"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.error_rows) == 1
    assert any("Invalid Sell Price" in e for e in preview.rows[0].errors)
    assert any("CESS Amount cannot be negative" in e for e in preview.rows[0].errors)


# =========================================================================
# 14. Blank optional fields accepted
# =========================================================================


def test_14_blank_optional_fields_accepted(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "blanks.xlsx"
    _write_xlsx(
        path,
        [
            C.COL_NAME,
            C.COL_ITEM_TYPE,
            C.COL_UOM,
            C.COL_NOTE,
            C.COL_BARCODE,
            C.COL_HSN_SAC,
            C.COL_CESS_PERCENT,
            C.COL_PRODUCT_GROUP,
        ],
        [["Bare Product", "Product", "NOS", "", "", "", "", ""]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert not preview.has_header_errors
    assert len(preview.valid_rows) == 1
    row_data = preview.valid_rows[0].data
    assert row_data is not None
    assert row_data.note == ""
    assert row_data.barcode_no == ""
    assert row_data.hsn_sac_code == ""
    assert row_data.cess_percent == Decimal("0")
    assert row_data.product_group_id is None


# =========================================================================
# 15. Service with blank stock fields accepted
# =========================================================================


def test_15_service_with_blank_stock_fields_accepted(
    service: ProductService, tmp_path: Path
) -> None:
    path = tmp_path / "srv_blank_stock.xlsx"
    _write_xlsx(
        path,
        [
            C.COL_NAME,
            C.COL_ITEM_TYPE,
            C.COL_STOCK_TYPE,
            C.COL_AVAILABLE_QTY,
            C.COL_LOW_STOCK_ALERT,
        ],
        [["Consulting", "Service", "", "", ""]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.valid_rows) == 1
    res = importer.commit(preview)
    assert res.created == 1
    p = service.search_products("Consulting")[0]
    assert p.opening_qty is None
    assert p.low_stock_alert is None


# =========================================================================
# 16. Additional Charges with blank stock fields accepted
# =========================================================================


def test_16_additional_charges_with_blank_stock_fields_accepted(
    service: ProductService, tmp_path: Path
) -> None:
    path = tmp_path / "chg_blank_stock.xlsx"
    _write_xlsx(
        path,
        [
            C.COL_NAME,
            C.COL_ITEM_TYPE,
            C.COL_STOCK_TYPE,
            C.COL_AVAILABLE_QTY,
            C.COL_LOW_STOCK_ALERT,
        ],
        [["Delivery Fee", "Additional Charges", "", "", ""]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.valid_rows) == 1
    res = importer.commit(preview)
    assert res.created == 1
    p = service.search_products("Delivery Fee")[0]
    assert p.opening_qty is None
    assert p.low_stock_alert is None


# =========================================================================
# 17. Duplicate detection
# =========================================================================


def test_17_duplicate_detection(service: ProductService, tmp_path: Path) -> None:
    # Existing product with barcode
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Existing Tool",
                item_type=ItemType.PRODUCT,
                unit_of_measurement="PCS",
                barcode_no="TOOL-999",
            )
        )
    )

    path = tmp_path / "dup.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_BARCODE],
        [
            ["Different Name", "Product", "PCS", "TOOL-999"],  # Duplicate by barcode
            ["existing tool", "Product", "PCS", ""],  # Duplicate by normalized name + item type
        ],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.duplicate_rows) == 2
    assert preview.rows[0].duplicate_of is not None
    assert preview.rows[0].duplicate_of.barcode_no == "TOOL-999"
    assert preview.rows[1].duplicate_of is not None
    assert preview.rows[1].duplicate_of.name == "Existing Tool"


# =========================================================================
# 18. Update existing
# =========================================================================


def test_18_update_existing(service: ProductService, tmp_path: Path) -> None:
    orig = service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Old Name",
                item_type=ItemType.PRODUCT,
                unit_of_measurement="PCS",
                barcode_no="UPD-001",
                sell_price=Decimal("100"),
            )
        )
    )

    path = tmp_path / "upd.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_BARCODE, C.COL_SELL_PRICE],
        [["New Name", "Product", "PCS", "UPD-001", "250"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.duplicate_rows) == 1
    # Set duplicate resolution to UPDATE
    preview.rows[0].resolution = DuplicateResolution.UPDATE

    result = importer.commit(preview)
    assert result.updated == 1
    assert result.created == 0

    reloaded = service.get_product(orig.id)
    assert reloaded is not None
    assert reloaded.name == "New Name"
    assert reloaded.sell_price == Decimal("250")


# =========================================================================
# 19. Skip duplicate
# =========================================================================


def test_19_skip_duplicate(service: ProductService, tmp_path: Path) -> None:
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Keep Me",
                item_type=ItemType.PRODUCT,
                unit_of_measurement="PCS",
                barcode_no="SKP-001",
                sell_price=Decimal("100"),
            )
        )
    )

    path = tmp_path / "skip.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_BARCODE, C.COL_SELL_PRICE],
        [["Keep Me", "Product", "PCS", "SKP-001", "500"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.duplicate_rows) == 1
    assert preview.rows[0].resolution is DuplicateResolution.SKIP

    result = importer.commit(preview)
    assert result.skipped == 1
    assert result.created == 0
    assert result.updated == 0

    prods = list(service.list_products())
    assert len(prods) == 1
    assert prods[0].sell_price == Decimal("100")


# =========================================================================
# 20. Create new duplicate
# =========================================================================


def test_20_create_new_duplicate(service: ProductService, tmp_path: Path) -> None:
    # Existing product without barcode (matched by Name + Item Type)
    service.create_product(
        CreateProductCommand(
            ProductInput(
                name="Shared Name",
                item_type=ItemType.PRODUCT,
                unit_of_measurement="PCS",
                sell_price=Decimal("100"),
            )
        )
    )

    path = tmp_path / "new_dup.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_SELL_PRICE],
        [["Shared Name", "Product", "PCS", "200"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.duplicate_rows) == 1

    # User explicitly requests CREATE_NEW
    preview.rows[0].resolution = DuplicateResolution.CREATE_NEW
    result = importer.commit(preview)
    assert result.created == 1

    prods = service.search_products("Shared Name")
    assert len(prods) == 2
    prices = {p.sell_price for p in prods}
    assert prices == {Decimal("100"), Decimal("200")}


# =========================================================================
# 21. Cancel import does not modify database
# =========================================================================


def test_21_cancel_import_does_not_modify_database(
    service: ProductService, tmp_path: Path
) -> None:
    path = tmp_path / "cancel.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM],
        [["Cancel Product", "Product", "PCS"]],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.valid_rows) == 1
    # User rejects/cancels: commit() is NOT called
    assert len(service.list_products()) == 0


# =========================================================================
# 22. Successful import persists after restart
# =========================================================================


def test_22_successful_import_persists_after_restart(tmp_path: Path) -> None:
    db_file = tmp_path / "test_persist.db"
    conn1 = connect(db_file)
    apply_pending(conn1)
    service1 = ProductService(
        SqliteProductRepository(conn1),
        id_generator=SequentialIdGenerator(1),
        clock=_TestClock(),
    )

    path = tmp_path / "restart.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_SELL_PRICE],
        [["Persisted Product", "Product", "PCS", "1250"]],
    )
    importer1 = ProductExcelImporter(service1, connection=conn1)
    preview1 = importer1.build_preview(path)
    importer1.commit(preview1)
    conn1.close()

    # Reopen connection (simulating app restart)
    conn2 = connect(db_file)
    service2 = ProductService(
        SqliteProductRepository(conn2),
        id_generator=SequentialIdGenerator(50),
        clock=_TestClock(),
    )
    prods = list(service2.list_products())
    conn2.close()

    assert len(prods) == 1
    assert prods[0].name == "Persisted Product"
    assert prods[0].sell_price == Decimal("1250")


# =========================================================================
# 23. Exported file can be imported again
# =========================================================================


def test_23_exported_file_can_be_imported_again(
    service: ProductService, group_service: ProductGroupService, tmp_path: Path
) -> None:
    _seed_items(service, group_service)
    out_path = tmp_path / "roundtrip_export.xlsx"
    exporter = ProductExcelExporter(
        group_name_resolver=lambda gid: group_service.get_group(gid).name
        if gid and group_service.get_group(gid)
        else ""
    )
    exporter.export(service.list_products(), ExportScope.ALL, out_path)

    # In a fresh database, import the exported file
    conn_fresh = connect(":memory:")
    apply_pending(conn_fresh)
    grp_fresh = ProductGroupService(
        SqliteProductGroupRepository(conn_fresh),
        id_generator=SequentialIdGenerator(500),
    )
    service_fresh = ProductService(
        SqliteProductRepository(conn_fresh),
        id_generator=SequentialIdGenerator(200),
        clock=_TestClock(),
    )

    importer = ProductExcelImporter(service_fresh, group_service=grp_fresh)
    preview = importer.build_preview(out_path)
    assert not preview.has_header_errors
    assert len(preview.error_rows) == 0
    assert len(preview.valid_rows) == 3

    result = importer.commit(preview)
    assert result.created == 3
    assert len(service_fresh.list_products()) == 3


# =========================================================================
# 24. Transaction rollback on database error
# =========================================================================


def test_24_transaction_rollback_on_db_error(service: ProductService, tmp_path: Path) -> None:
    path = tmp_path / "tx_test.xlsx"
    _write_xlsx(
        path,
        [C.COL_NAME, C.COL_ITEM_TYPE, C.COL_UOM, C.COL_BARCODE],
        [
            ["Valid Item 1", "Product", "PCS", "BAR-1"],
            ["Valid Item 2", "Product", "PCS", "BAR-2"],
        ],
    )
    importer = ProductExcelImporter(service)
    preview = importer.build_preview(path)
    assert len(preview.valid_rows) == 2

    # Simulate an error on row 2 during commit
    original_create = service.create_product
    call_count = 0

    def mock_create(cmd: CreateProductCommand):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise sqlite3.IntegrityError("Simulated DB integrity failure")
        return original_create(cmd)

    service.create_product = mock_create  # type: ignore[method-assign]

    with pytest.raises(sqlite3.IntegrityError):
        importer.commit(preview)

    # Database must have rolled back completely: 0 products saved
    assert len(service.list_products()) == 0


# =========================================================================
# 25. Sample Excel is valid and imports with 0 errors
# =========================================================================


def test_25_sample_excel_is_valid_and_imports(service: ProductService, tmp_path: Path) -> None:
    sample_path = tmp_path / "sample_test.xlsx"
    write_sample_excel(sample_path)

    importer = ProductExcelImporter(service)
    preview = importer.build_preview(sample_path)

    assert not preview.has_header_errors
    assert len(preview.error_rows) == 0
    assert len(preview.valid_rows) > 0
    result = importer.commit(preview)
    assert result.created == len(preview.valid_rows)
    assert len(service.list_products()) == len(preview.valid_rows)
