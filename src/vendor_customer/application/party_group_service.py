"""Application service for Customer / Vendor group management.

Minimum capability per product rules, section 12: create, rename, archive
safely, and select. A group referenced by any party is never hard-deleted; it
is archived. Group names are unique among active groups.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from common.domain.ids import IdGenerator, Uuid4Generator
from vendor_customer.application.errors import PartyServiceError
from vendor_customer.domain.models import PartyGroup
from vendor_customer.domain.repositories import PartyGroupRepository


class PartyGroupService:
    """Use-case entry point for managing party groups."""

    def __init__(
        self,
        repository: PartyGroupRepository,
        *,
        id_generator: IdGenerator | None = None,
    ) -> None:
        self._repo = repository
        self._id_gen: IdGenerator = id_generator or Uuid4Generator()

    def create_group(self, name: str) -> PartyGroup:
        clean = name.strip()
        if not clean:
            raise PartyServiceError("Group name is required.")
        if self._repo.get_by_name(clean) is not None:
            raise PartyServiceError(f"A group named '{clean}' already exists.")
        group = PartyGroup(id=self._id_gen(), name=clean, is_active=True)
        self._repo.save(group)
        return group

    def rename_group(self, group_id: uuid.UUID, new_name: str) -> PartyGroup:
        clean = new_name.strip()
        if not clean:
            raise PartyServiceError("Group name is required.")
        group = self._repo.get(group_id)
        if group is None:
            raise PartyServiceError("Group not found.")
        clash = self._repo.get_by_name(clean)
        if clash is not None and clash.id != group_id:
            raise PartyServiceError(f"A group named '{clean}' already exists.")
        renamed = group.model_copy(update={"name": clean})
        self._repo.save(renamed)
        return renamed

    def archive_group(self, group_id: uuid.UUID) -> PartyGroup:
        """Archive a group. Allowed even if referenced (references are kept).

        Archiving (never deleting) keeps existing party references intact
        (product rules, section 12).
        """
        group = self._repo.get(group_id)
        if group is None:
            raise PartyServiceError("Group not found.")
        archived = group.model_copy(update={"is_active": False})
        self._repo.save(archived)
        return archived

    def list_groups(self, *, include_archived: bool = False) -> Sequence[PartyGroup]:
        return self._repo.list_all(include_archived=include_archived)

    def get_group(self, group_id: uuid.UUID) -> PartyGroup | None:
        return self._repo.get(group_id)
