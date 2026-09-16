"""SQLite implementation of :class:`ProductRepository`.

Uses the schema created by migration ``0004_products.sql`` (never creates
tables ad hoc). Parameterized SQL only. Participates in the caller's
transaction and never begins/commits its own (DECISIONS D-026). Search is
database-backed (product/service rules, section 19): it matches name, barcode,
or HSN/SAC with a single SQL query rather than loading the whole table.
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from product_service.domain.models import ItemType, Product
from product_service.domain.rules import normalize_name
from product_service.infrastructure.db.mappers import product_to_row, row_to_product

_COLUMNS = (
    "id, item_type, name, note, barcode_no, hsn_sac_code, unit_of_measurement, "
    "tax_rate, cess_percent, cess_type, cess_amount_paise, no_itc, "
    "sell_price_paise, sell_price_incl_tax_paise, sale_discount_type, sale_discount_value, "
    "purchase_price_paise, purchase_price_incl_tax_paise, purchase_discount_type, "
    "purchase_discount_value, "
    "stock_type, opening_qty, low_stock_alert, "
    "product_group_id, image_asset_id, "
    "is_manufactured, is_sellable, visible_on_documents, "
    "is_active, created_at, updated_at"
)


class SqliteProductRepository:
    """SQLite-backed product repository."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, product_id: uuid.UUID) -> Product | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM products WHERE id = ?",
            (to_canonical(product_id),),
        ).fetchone()
        return None if row is None else row_to_product(row)

    def get_by_barcode(self, barcode_no: str) -> Product | None:
        clean = barcode_no.strip()
        if not clean:
            return None
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM products WHERE barcode_no = ? "
            "ORDER BY is_active DESC LIMIT 1",
            (clean,),
        ).fetchone()
        return None if row is None else row_to_product(row)

    def find_by_name_and_type(self, name: str, item_type: ItemType) -> Product | None:
        key = normalize_name(name)
        if not key:
            return None
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM products WHERE item_type = ?",
            (item_type.value,),
        ).fetchall()
        for row in rows:
            product = row_to_product(row)
            if normalize_name(product.name) == key:
                return product
        return None

    def list_all(
        self,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        query, params = self._base_query(
            item_type=item_type,
            include_archived=include_archived,
            sellable_only=sellable_only,
        )
        query += " ORDER BY name COLLATE NOCASE ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [row_to_product(r) for r in rows]

    def search(
        self,
        term: str,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        needle = term.strip()
        if not needle:
            return self.list_all(
                item_type=item_type,
                include_archived=include_archived,
                sellable_only=sellable_only,
            )
        query, params = self._base_query(
            item_type=item_type,
            include_archived=include_archived,
            sellable_only=sellable_only,
        )
        like = f"%{needle}%"
        query += (
            " AND (name LIKE ? COLLATE NOCASE"
            " OR barcode_no LIKE ? COLLATE NOCASE"
            " OR hsn_sac_code LIKE ? COLLATE NOCASE)"
        )
        params.extend([like, like, like])
        query += " ORDER BY name COLLATE NOCASE ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [row_to_product(r) for r in rows]

    def save(self, product: Product) -> None:
        row = product_to_row(product)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO products ({columns}) VALUES ({placeholders})",
            row,
        )

    def archive(self, product_id: uuid.UUID) -> bool:
        cur = self._conn.execute(
            "UPDATE products SET is_active = 0 WHERE id = ?",
            (to_canonical(product_id),),
        )
        return cur.rowcount > 0

    def _base_query(
        self,
        *,
        item_type: ItemType | None,
        include_archived: bool,
        sellable_only: bool,
    ) -> tuple[str, list[object]]:
        query = f"SELECT {_COLUMNS} FROM products WHERE 1 = 1"
        params: list[object] = []
        if not include_archived:
            query += " AND is_active = 1"
        if sellable_only:
            query += " AND is_sellable = 1"
        if item_type is not None:
            query += " AND item_type = ?"
            params.append(item_type.value)
        return query, params
