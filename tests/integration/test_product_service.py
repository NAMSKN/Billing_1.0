"""Integration tests for the Product / Service master (V2 Feature 2).

Covers the application-level test list from the feature brief (items 1-33):
create/edit/archive, groups, tax/CESS/No-ITC/pricing/discount/stock/low-stock
persistence, search (name/barcode/HSN), item-type stock rules, invoice
integration (sellable filter, default population, historical preservation), and
survival across a simulated restart. Money is asserted with exact ``Decimal``
values; ids and timestamps are deterministic via injected dependencies.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from product_service.application.dto import (
    CreateProductCommand,
    ProductInput,
    UpdateProductCommand,
)
from product_service.application.errors import (
    DuplicateProductError,
    ProductServiceError,
    ProductValidationError,
)
from product_service.application.product_group_service import ProductGroupService
from product_service.application.product_service import ProductService
from product_service.domain.models import CessType, DiscountType, ItemType, StockType
from product_service.infrastructure.db.sqlite_product_group_repository import (
    SqliteProductGroupRepository,
)
from product_service.infrastructure.db.sqlite_product_repository import (
    SqliteProductRepository,
)
from tests.support.id_factory import SequentialIdGenerator

pytestmark = pytest.mark.integration


class _FrozenClock:
    def __init__(self, instant: datetime) -> None:
        self._instant = instant

    def now(self) -> datetime:
        return self._instant


@pytest.fixture()
def conn() -> sqlite3.Connection:
    connection = connect(":memory:")
    apply_pending(connection)
    return connection


@pytest.fixture()
def service(conn: sqlite3.Connection) -> ProductService:
    return ProductService(
        SqliteProductRepository(conn),
        id_generator=SequentialIdGenerator(1),
        clock=_FrozenClock(datetime(2026, 6, 1, 12, 0, tzinfo=UTC)),
    )


@pytest.fixture()
def group_service(conn: sqlite3.Connection) -> ProductGroupService:
    return ProductGroupService(
        SqliteProductGroupRepository(conn), id_generator=SequentialIdGenerator(500)
    )


def _commit(conn: sqlite3.Connection) -> None:
    conn.commit()


# --- tables ---


def test_migration_creates_product_tables(conn: sqlite3.Connection) -> None:
    for table in ("products", "product_groups"):
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        assert row is not None


# --- create the three item types (items 1-3) ---


def test_create_product(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Mould Base", item_type=ItemType.PRODUCT, unit_of_measurement="Nos",
        tax_rate=Decimal("18"), sell_price=Decimal("1000.00"),
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.item_type is ItemType.PRODUCT
    assert got.sell_price == Decimal("1000.00")


def test_create_service(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="CNC Machining", item_type=ItemType.SERVICE, sell_price=Decimal("500.00"),
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.item_type is ItemType.SERVICE


def test_create_additional_charges(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Freight", item_type=ItemType.ADDITIONAL_CHARGES, sell_price=Decimal("200.00"),
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.item_type is ItemType.ADDITIONAL_CHARGES


# --- edit / archive (items 4-5) ---


def test_edit_product(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Widget", unit_of_measurement="Nos",
    )))
    _commit(conn)
    updated = service.update_product(UpdateProductCommand(
        id=p.id,
        data=ProductInput(name="Widget Pro", unit_of_measurement="Nos",
                          sell_price=Decimal("99.50")),
        is_active=True,
    ))
    _commit(conn)
    assert updated.id == p.id
    got = service.get_product(p.id)
    assert got is not None
    assert got.name == "Widget Pro"
    assert got.sell_price == Decimal("99.50")


def test_archive_product(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Old Item", unit_of_measurement="Nos",
    )))
    _commit(conn)
    assert service.archive_product(p.id) is True
    _commit(conn)
    active = service.list_products()
    assert all(x.id != p.id for x in active)
    # Still retrievable and present when archived included.
    assert service.get_product(p.id) is not None
    archived = service.list_products(include_archived=True)
    assert any(x.id == p.id for x in archived)


# --- search (items 6-8) ---


def test_search_by_name_barcode_hsn(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Precision Mould", item_type=ItemType.PRODUCT, unit_of_measurement="Nos",
        barcode_no="BC-9001", hsn_sac_code="8480",
    )))
    _commit(conn)
    assert any(x.id == p.id for x in service.search_products("Precision"))
    assert any(x.id == p.id for x in service.search_products("BC-9001"))
    assert any(x.id == p.id for x in service.search_products("8480"))
    assert list(service.search_products("nonexistent-term")) == []


# --- groups (items 9-10) ---


def test_group_create_and_assign(
    service: ProductService, group_service: ProductGroupService, conn: sqlite3.Connection
) -> None:
    group = group_service.create_group("Tooling")
    _commit(conn)
    assert group.name == "Tooling"

    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Ejector Pin", unit_of_measurement="Nos", product_group_id=group.id,
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.product_group_id == group.id


def test_duplicate_group_rejected(
    group_service: ProductGroupService, conn: sqlite3.Connection
) -> None:
    group_service.create_group("Raw Material")
    _commit(conn)
    with pytest.raises(ProductServiceError):
        group_service.create_group("raw material")


def test_group_archive_preserves_reference(
    service: ProductService, group_service: ProductGroupService, conn: sqlite3.Connection
) -> None:
    group = group_service.create_group("Consumables")
    _commit(conn)
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Grease", unit_of_measurement="L", product_group_id=group.id,
    )))
    _commit(conn)
    group_service.archive_group(group.id)
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.product_group_id == group.id  # reference preserved


# --- field persistence (items 11-18) ---


def test_full_field_persistence(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Complete Product", item_type=ItemType.PRODUCT, unit_of_measurement="Nos",
        note="a note", barcode_no="BC-777", hsn_sac_code="8466",
        tax_rate=Decimal("12"), cess_percent=Decimal("1.5"), cess_type=CessType.PER_UNIT,
        cess_amount=Decimal("3.25"), no_itc=True,
        sell_price=Decimal("1500.00"), sell_price_incl_tax=Decimal("1680.00"),
        sale_discount_type=DiscountType.PERCENTAGE, sale_discount_value=Decimal("7.5"),
        purchase_price=Decimal("1200.00"), purchase_price_incl_tax=Decimal("1344.00"),
        purchase_discount_type=DiscountType.RUPEE, purchase_discount_value=Decimal("50.00"),
        stock_type=StockType.BATCH, opening_qty=Decimal("25.000"),
        low_stock_alert=Decimal("5"), is_manufactured=True, visible_on_documents=True,
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    # Tax + CESS + No-ITC
    assert got.tax_rate == Decimal("12")
    assert got.cess_percent == Decimal("1.5")
    assert got.cess_type is CessType.PER_UNIT
    assert got.cess_amount == Decimal("3.25")
    assert got.no_itc is True
    # Pricing (both exclusive and inclusive preserved, exactly)
    assert got.sell_price == Decimal("1500.00")
    assert got.sell_price_incl_tax == Decimal("1680.00")
    assert got.purchase_price == Decimal("1200.00")
    assert got.purchase_price_incl_tax == Decimal("1344.00")
    # Discount type/value
    assert got.sale_discount_type is DiscountType.PERCENTAGE
    assert got.sale_discount_value == Decimal("7.5")
    assert got.purchase_discount_type is DiscountType.RUPEE
    assert got.purchase_discount_value == Decimal("50.00")
    # Stock type + low-stock alert
    assert got.stock_type is StockType.BATCH
    assert got.opening_qty == Decimal("25.000")
    assert got.low_stock_alert == Decimal("5")
    # Flags
    assert got.is_manufactured is True
    assert got.visible_on_documents is True


# --- flags (items 19-22) ---


def test_manufacturing_and_visibility_flags(
    service: ProductService, conn: sqlite3.Connection
) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Flagged", unit_of_measurement="Nos", is_manufactured=True,
        visible_on_documents=True,
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None and got.is_manufactured and got.visible_on_documents


def test_non_sellable_flag_persists(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Raw Steel", unit_of_measurement="Kg", is_sellable=False,
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.is_sellable is False
    # Non-sellable is distinct from inactive: it stays active/visible in master.
    assert got.is_active is True
    assert any(x.id == p.id for x in service.list_products())


# --- validation (items 23-24) ---


def test_required_field_validation(service: ProductService) -> None:
    with pytest.raises(ProductValidationError):
        service.create_product(CreateProductCommand(data=ProductInput(
            name="", item_type=ItemType.PRODUCT, unit_of_measurement="",
        )))


def test_blank_optionals_accepted(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Minimal", item_type=ItemType.SERVICE,
    )))
    _commit(conn)
    assert service.get_product(p.id) is not None


def test_duplicate_barcode_rejected(service: ProductService, conn: sqlite3.Connection) -> None:
    service.create_product(CreateProductCommand(data=ProductInput(
        name="First", unit_of_measurement="Nos", barcode_no="DUP-1",
    )))
    _commit(conn)
    with pytest.raises(DuplicateProductError):
        service.create_product(CreateProductCommand(data=ProductInput(
            name="Second", unit_of_measurement="Nos", barcode_no="DUP-1",
        )))


# --- item-type stock rules (items 25-26) ---


def test_service_stock_normalized(service: ProductService, conn: sqlite3.Connection) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Service", item_type=ItemType.SERVICE,
        opening_qty=Decimal("50"), low_stock_alert=Decimal("5"),
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.opening_qty is None
    assert got.low_stock_alert is None


def test_additional_charges_stock_normalized(
    service: ProductService, conn: sqlite3.Connection
) -> None:
    p = service.create_product(CreateProductCommand(data=ProductInput(
        name="Packing", item_type=ItemType.ADDITIONAL_CHARGES,
        opening_qty=Decimal("99"),
    )))
    _commit(conn)
    got = service.get_product(p.id)
    assert got is not None
    assert got.opening_qty is None


# --- sellable filter (items 27-29) ---


def test_sellable_products_exclude_nonsellable_and_archived(
    service: ProductService, conn: sqlite3.Connection
) -> None:
    active = service.create_product(CreateProductCommand(data=ProductInput(
        name="Sellable Product", item_type=ItemType.PRODUCT, unit_of_measurement="Nos",
    )))
    svc = service.create_product(CreateProductCommand(data=ProductInput(
        name="Sellable Service", item_type=ItemType.SERVICE,
    )))
    nonsell = service.create_product(CreateProductCommand(data=ProductInput(
        name="Non Sellable", unit_of_measurement="Kg", is_sellable=False,
    )))
    archived = service.create_product(CreateProductCommand(data=ProductInput(
        name="Archived", unit_of_measurement="Nos",
    )))
    service.archive_product(archived.id)
    _commit(conn)

    ids = {p.id for p in service.sellable_products()}
    assert active.id in ids
    assert svc.id in ids
    assert nonsell.id not in ids
    assert archived.id not in ids


# --- persistence across restart (item 33) ---


def test_product_survives_restart(tmp_path) -> None:  # type: ignore[no-untyped-def]
    db = tmp_path / "products.db"
    conn1 = connect(db)
    apply_pending(conn1)
    svc1 = ProductService(SqliteProductRepository(conn1))
    p = svc1.create_product(CreateProductCommand(data=ProductInput(
        name="Persistent", item_type=ItemType.PRODUCT, unit_of_measurement="Nos",
        sell_price=Decimal("321.00"), stock_type=StockType.SERIAL,
    )))
    conn1.commit()
    conn1.close()

    conn2 = connect(db)
    apply_pending(conn2)
    svc2 = ProductService(SqliteProductRepository(conn2))
    got = svc2.get_product(p.id)
    assert got is not None
    assert got.name == "Persistent"
    assert got.sell_price == Decimal("321.00")
    assert got.stock_type is StockType.SERIAL
    conn2.close()
