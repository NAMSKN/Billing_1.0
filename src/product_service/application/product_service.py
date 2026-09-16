"""Application service for the Product / Service master.

Orchestrates create/update/archive/list/search with offline validation.
Timestamps use an injected clock and ids an injected :class:`IdGenerator` for
deterministic tests. Stock configuration is only meaningful for a physical
``PRODUCT``; for a ``SERVICE`` or ``ADDITIONAL_CHARGES`` the service normalizes
stock fields away so no stock quantity is ever fabricated (product/service
rules, sections 5, 6, 16).

The product stores tax defaults only; this service never calculates GST. Money
stays as ``Decimal`` here and is converted to integer paise at the repository
boundary.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from common.domain.ids import IdGenerator, Uuid4Generator
from product_service.application.dto import (
    CreateProductCommand,
    ProductInput,
    UpdateProductCommand,
)
from product_service.application.errors import (
    DuplicateProductError,
    ProductValidationError,
)
from product_service.domain.models import ItemType, Product, StockType
from product_service.domain.repositories import ProductRepository
from product_service.domain.rules import validate_product


@runtime_checkable
class SupportsNow(Protocol):
    """Minimal clock: returns the current timezone-aware instant."""

    def now(self) -> datetime: ...


class _SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class ProductService:
    """Use-case entry point for managing products / services / charges."""

    def __init__(
        self,
        repository: ProductRepository,
        *,
        id_generator: IdGenerator | None = None,
        clock: SupportsNow | None = None,
    ) -> None:
        self._repo = repository
        self._id_gen: IdGenerator = id_generator or Uuid4Generator()
        self._clock: SupportsNow = clock or _SystemClock()

    # --- create / update ---

    def create_product(self, cmd: CreateProductCommand) -> Product:
        """Validate and persist a new product. Raises on validation/duplicate."""
        now = self._clock.now().isoformat()
        product = self._assemble(
            product_id=self._id_gen(),
            data=cmd.data,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        self._reject_if_invalid(product)
        self._reject_if_duplicate(product)
        self._repo.save(product)
        return product

    def update_product(self, cmd: UpdateProductCommand) -> Product:
        """Validate and persist changes to an existing product."""
        existing = self._repo.get(cmd.id)
        created_at = existing.created_at if existing is not None else ""
        product = self._assemble(
            product_id=cmd.id,
            data=cmd.data,
            is_active=cmd.is_active,
            created_at=created_at,
            updated_at=self._clock.now().isoformat(),
        )
        self._reject_if_invalid(product)
        self._reject_if_duplicate(product)
        self._repo.save(product)
        return product

    # --- queries ---

    def get_product(self, product_id: uuid.UUID) -> Product | None:
        return self._repo.get(product_id)

    def list_products(
        self,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        return self._repo.list_all(
            item_type=item_type,
            include_archived=include_archived,
            sellable_only=sellable_only,
        )

    def search_products(
        self,
        term: str,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        """DB-backed search by name, barcode, or HSN/SAC (product rules, 19)."""
        needle = term.strip()
        if not needle:
            return self._repo.list_all(
                item_type=item_type,
                include_archived=include_archived,
                sellable_only=sellable_only,
            )
        return self._repo.search(
            needle,
            item_type=item_type,
            include_archived=include_archived,
            sellable_only=sellable_only,
        )

    def sellable_products(
        self, *, item_type: ItemType | None = None
    ) -> Sequence[Product]:
        """Active, sellable items for new sales documents (product rules, 23).

        Excludes archived and non-sellable items so they can never be picked in
        a new sales invoice.
        """
        return self._repo.list_all(
            item_type=item_type, include_archived=False, sellable_only=True
        )

    def archive_product(self, product_id: uuid.UUID) -> bool:
        """Soft-delete a product; historical documents keep referencing it."""
        return self._repo.archive(product_id)

    def find_duplicate(self, data: ProductInput) -> Product | None:
        """Return an existing product matching by barcode, else name+type."""
        barcode = data.barcode_no.strip()
        if barcode:
            match = self._repo.get_by_barcode(barcode)
            if match is not None:
                return match
        if data.name.strip():
            return self._repo.find_by_name_and_type(data.name, data.item_type)
        return None

    # --- internals ---

    def _assemble(
        self,
        *,
        product_id: uuid.UUID,
        data: ProductInput,
        is_active: bool,
        created_at: str,
        updated_at: str,
    ) -> Product:
        tracks_stock = data.item_type.tracks_stock
        # Services / additional charges never carry stock: normalize away any
        # stock configuration so no stock quantity is fabricated.
        stock_type = data.stock_type if tracks_stock else StockType.NORMAL
        opening_qty = data.opening_qty if tracks_stock else None
        low_stock_alert = data.low_stock_alert if tracks_stock else None
        return Product(
            id=product_id,
            item_type=data.item_type,
            name=data.name.strip(),
            note=data.note.strip(),
            barcode_no=data.barcode_no.strip(),
            hsn_sac_code=data.hsn_sac_code.strip(),
            unit_of_measurement=data.unit_of_measurement.strip(),
            tax_rate=data.tax_rate,
            cess_percent=data.cess_percent,
            cess_type=data.cess_type,
            cess_amount=data.cess_amount,
            no_itc=data.no_itc,
            sell_price=data.sell_price,
            sell_price_incl_tax=data.sell_price_incl_tax,
            sale_discount_type=data.sale_discount_type,
            sale_discount_value=data.sale_discount_value,
            purchase_price=data.purchase_price,
            purchase_price_incl_tax=data.purchase_price_incl_tax,
            purchase_discount_type=data.purchase_discount_type,
            purchase_discount_value=data.purchase_discount_value,
            stock_type=stock_type,
            opening_qty=opening_qty,
            low_stock_alert=low_stock_alert,
            product_group_id=data.product_group_id,
            image_asset_id=data.image_asset_id,
            is_manufactured=data.is_manufactured,
            is_sellable=data.is_sellable,
            visible_on_documents=data.visible_on_documents,
            is_active=is_active,
            created_at=created_at,
            updated_at=updated_at,
        )

    def _reject_if_invalid(self, product: Product) -> None:
        errors = validate_product(product)
        if errors:
            raise ProductValidationError(errors)

    def _reject_if_duplicate(self, product: Product) -> None:
        barcode = product.barcode_no.strip()
        if not barcode:
            return
        existing = self._repo.get_by_barcode(barcode)
        if existing is not None and existing.id != product.id:
            raise DuplicateProductError(
                f"A product with barcode '{barcode}' already exists.",
                existing_id=existing.id,
            )
