"""Repository ports for the Product / Service master.

Typed :class:`~typing.Protocol` contracts. Application services depend on these
ports, not on concrete SQLite classes (DECISIONS D-021). Ports accept and
return domain models; conversion to/from storage happens inside the
implementations. Repositories participate in the caller's transaction and never
begin/commit their own (DECISIONS D-026).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from product_service.domain.models import ItemType, Product, ProductGroup


@runtime_checkable
class ProductRepository(Protocol):
    """Persistence for product / service / additional-charges records."""

    def get(self, product_id: uuid.UUID) -> Product | None:
        """Fetch a product by id (active or archived), or ``None``."""
        ...

    def get_by_barcode(self, barcode_no: str) -> Product | None:
        """Fetch a product by exact barcode (any status), or ``None``."""
        ...

    def find_by_name_and_type(self, name: str, item_type: ItemType) -> Product | None:
        """Fetch a product by normalized name + item type for duplicate matching."""
        ...

    def list_all(
        self,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        """List products, optionally filtered by type, archived and sellable."""
        ...

    def search(
        self,
        term: str,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        """DB-backed search by name, barcode, or HSN/SAC (product rules, 19)."""
        ...

    def save(self, product: Product) -> None:
        """Insert or update a product record."""
        ...

    def archive(self, product_id: uuid.UUID) -> bool:
        """Soft-delete: mark a product inactive. Returns ``True`` if one changed."""
        ...


@runtime_checkable
class ProductGroupRepository(Protocol):
    """Persistence for selectable product groups."""

    def get(self, group_id: uuid.UUID) -> ProductGroup | None:
        ...

    def get_by_name(self, name: str) -> ProductGroup | None:
        ...

    def list_all(self, *, include_archived: bool = False) -> Sequence[ProductGroup]:
        ...

    def save(self, group: ProductGroup) -> None:
        ...

    def archive(self, group_id: uuid.UUID) -> bool:
        ...

    def count_products_in_group(self, group_id: uuid.UUID) -> int:
        """Number of products referencing this group (for safe archival)."""
        ...
