"""Application service for product group management.

Minimum capability per product/service rules, section 9: create, rename,
archive safely, and select. A group referenced by any product is never
hard-deleted; it is archived. Group names are unique among active groups.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from common.domain.ids import IdGenerator, Uuid4Generator
from product_service.application.errors import ProductServiceError
from product_service.domain.models import ProductGroup
from product_service.domain.repositories import ProductGroupRepository


class ProductGroupService:
    """Use-case entry point for managing product groups."""

    def __init__(
        self,
        repository: ProductGroupRepository,
        *,
        id_generator: IdGenerator | None = None,
    ) -> None:
        self._repo = repository
        self._id_gen: IdGenerator = id_generator or Uuid4Generator()

    def create_group(self, name: str) -> ProductGroup:
        clean = name.strip()
        if not clean:
            raise ProductServiceError("Group name is required.")
        if self._repo.get_by_name(clean) is not None:
            raise ProductServiceError(f"A group named '{clean}' already exists.")
        group = ProductGroup(id=self._id_gen(), name=clean, is_active=True)
        self._repo.save(group)
        return group

    def rename_group(self, group_id: uuid.UUID, new_name: str) -> ProductGroup:
        clean = new_name.strip()
        if not clean:
            raise ProductServiceError("Group name is required.")
        group = self._repo.get(group_id)
        if group is None:
            raise ProductServiceError("Group not found.")
        clash = self._repo.get_by_name(clean)
        if clash is not None and clash.id != group_id:
            raise ProductServiceError(f"A group named '{clean}' already exists.")
        renamed = group.model_copy(update={"name": clean})
        self._repo.save(renamed)
        return renamed

    def archive_group(self, group_id: uuid.UUID) -> ProductGroup:
        """Archive a group. Allowed even if referenced (references are kept).

        Archiving (never deleting) keeps existing product references intact
        (product/service rules, section 9: do not allow deletion that breaks
        product references).
        """
        group = self._repo.get(group_id)
        if group is None:
            raise ProductServiceError("Group not found.")
        archived = group.model_copy(update={"is_active": False})
        self._repo.save(archived)
        return archived

    def list_groups(self, *, include_archived: bool = False) -> Sequence[ProductGroup]:
        return self._repo.list_all(include_archived=include_archived)

    def get_group(self, group_id: uuid.UUID) -> ProductGroup | None:
        return self._repo.get(group_id)
