"""Controller for the product master screen.

Holds product use-case logic behind the PySide6 widgets so the widgets stay
thin (no SQL, no business rules — DECISIONS D-021). Delegates to the
application services. Product images are imported through the shared versioned
asset store and referenced by asset id; the raw bytes are never stored in the
product row (product/service rules, section 10).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from pathlib import Path

from invoice_generator.domain.models import Asset
from product_service.application.dto import (
    CreateProductCommand,
    ProductInput,
    UpdateProductCommand,
)
from product_service.application.product_group_service import ProductGroupService
from product_service.application.product_service import ProductService
from product_service.domain.models import ItemType, Product, ProductGroup
from product_service.infrastructure.excel.export_service import (
    ExportScope,
    ProductExcelExporter,
)
from product_service.infrastructure.excel.import_service import (
    ImportAs,
    ImportPreview,
    ImportResult,
    ProductExcelImporter,
)
from product_service.infrastructure.excel.sample_template import write_sample_excel


class ProductImageError(Exception):
    """Raised when a product image cannot be loaded or imported."""


class ProductController:
    """Use-case entry point for the product list screen and editor."""

    def __init__(
        self,
        product_service: ProductService,
        group_service: ProductGroupService,
        *,
        asset_import: object | None = None,
        asset_lookup: object | None = None,
    ) -> None:
        self._products = product_service
        self._groups = group_service
        # ``asset_import`` imports a file and returns an :class:`Asset`;
        # ``asset_lookup`` resolves an asset id to an :class:`Asset` (for the
        # stored path). Both are optional so the controller works headless in
        # tests without the asset store.
        self._asset_import = asset_import
        self._asset_lookup = asset_lookup

    # --- products ---

    def list_products(
        self,
        *,
        item_type: ItemType | None = None,
        include_archived: bool = False,
        sellable_only: bool = False,
    ) -> Sequence[Product]:
        return self._products.list_products(
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
        return self._products.search_products(
            term,
            item_type=item_type,
            include_archived=include_archived,
            sellable_only=sellable_only,
        )

    def get_product(self, product_id: uuid.UUID) -> Product | None:
        return self._products.get_product(product_id)

    def create_product(self, data: ProductInput) -> Product:
        return self._products.create_product(CreateProductCommand(data=data))

    def update_product(
        self, product_id: uuid.UUID, data: ProductInput, *, is_active: bool
    ) -> Product:
        return self._products.update_product(
            UpdateProductCommand(id=product_id, data=data, is_active=is_active)
        )

    def archive_product(self, product_id: uuid.UUID) -> bool:
        return self._products.archive_product(product_id)

    # --- groups ---

    def list_groups(self) -> Sequence[ProductGroup]:
        return self._groups.list_groups()

    def create_group(self, name: str) -> ProductGroup:
        return self._groups.create_group(name)

    def rename_group(self, group_id: uuid.UUID, name: str) -> ProductGroup:
        return self._groups.rename_group(group_id, name)

    def archive_group(self, group_id: uuid.UUID) -> ProductGroup:
        return self._groups.archive_group(group_id)

    def group_name(self, group_id: uuid.UUID | None) -> str:
        if group_id is None:
            return ""
        group = self._groups.get_group(group_id)
        return group.name if group is not None else ""

    # --- images ---

    def import_image(self, source: str | Path) -> uuid.UUID:
        """Import an image file into the asset store; return its asset id.

        Raises :class:`ProductImageError` if importing is unavailable or the
        file cannot be read.
        """
        if self._asset_import is None:
            raise ProductImageError("Image storage is not available.")
        try:
            asset = self._asset_import(Path(source))  # type: ignore[operator]
        except Exception as exc:  # noqa: BLE001 - boundary
            raise ProductImageError(f"Could not import image: {exc}") from exc
        if not isinstance(asset, Asset):
            raise ProductImageError("Image import returned an unexpected result.")
        return asset.id

    def image_path(self, asset_id: uuid.UUID | None) -> str | None:
        """Return the stored path for a product image asset, or ``None``.

        A missing asset (or no lookup wired) returns ``None`` so a product with
        a dangling image reference still loads (product/service rules, 10).
        """
        if asset_id is None or self._asset_lookup is None:
            return None
        try:
            asset = self._asset_lookup(asset_id)  # type: ignore[operator]
        except Exception:  # noqa: BLE001 - boundary: never break product loading
            return None
        if not isinstance(asset, Asset):
            return None
        return asset.stored_path or None

    # --- excel ---

    def export(
        self,
        scope: ExportScope,
        path: str | Path,
        *,
        include_archived: bool = False,
        overwrite: bool = False,
    ) -> Path:
        products = self._products.list_products(include_archived=include_archived)
        exporter = ProductExcelExporter(
            group_name_resolver=lambda gid: self.group_name(gid)
        )
        return exporter.export(products, scope, path, overwrite=overwrite)

    def build_import_preview(
        self, path: str | Path, *, import_as: ImportAs = ImportAs.FILE
    ) -> ImportPreview:
        importer = ProductExcelImporter(self._products, group_service=self._groups)
        return importer.build_preview(path, import_as=import_as)

    def commit_import(self, preview: ImportPreview) -> ImportResult:
        importer = ProductExcelImporter(self._products, group_service=self._groups)
        return importer.commit(preview)

    def download_sample(self, path: str | Path, *, overwrite: bool = False) -> Path:
        return write_sample_excel(path, overwrite=overwrite)
