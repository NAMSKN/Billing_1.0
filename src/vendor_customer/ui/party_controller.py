"""Controller for the party master screen (Task: UI).

Holds party use-case logic behind the PySide6 widgets so the widgets stay thin
(no SQL, no business rules — DECISIONS D-021). Delegates to the application
services and the Excel import/export services.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from pathlib import Path

from vendor_customer.application.dto import CreatePartyCommand, PartyInput, UpdatePartyCommand
from vendor_customer.application.party_group_service import PartyGroupService
from vendor_customer.application.party_service import PartyService
from vendor_customer.domain.models import Party, PartyGroup, PartyType
from vendor_customer.infrastructure.excel.export_service import (
    ExportScope,
    PartyExcelExporter,
)
from vendor_customer.infrastructure.excel.import_service import (
    ImportAs,
    ImportPreview,
    ImportResult,
    PartyExcelImporter,
)


class PartyController:
    """Use-case entry point for the party list screen and editor."""

    def __init__(
        self,
        party_service: PartyService,
        group_service: PartyGroupService,
    ) -> None:
        self._parties = party_service
        self._groups = group_service

    # --- parties ---

    def list_parties(
        self,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        return self._parties.list_parties(
            party_type=party_type, include_archived=include_archived
        )

    def search_parties(
        self,
        term: str,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        return self._parties.search_parties(
            term, party_type=party_type, include_archived=include_archived
        )

    def get_party(self, party_id: uuid.UUID) -> Party | None:
        return self._parties.get_party(party_id)

    def create_party(self, data: PartyInput) -> Party:
        return self._parties.create_party(CreatePartyCommand(data=data))

    def update_party(self, party_id: uuid.UUID, data: PartyInput, *, is_active: bool) -> Party:
        return self._parties.update_party(
            UpdatePartyCommand(id=party_id, data=data, is_active=is_active)
        )

    def archive_party(self, party_id: uuid.UUID) -> bool:
        return self._parties.archive_party(party_id)

    # --- groups ---

    def list_groups(self) -> Sequence[PartyGroup]:
        return self._groups.list_groups()

    def create_group(self, name: str) -> PartyGroup:
        return self._groups.create_group(name)

    def rename_group(self, group_id: uuid.UUID, name: str) -> PartyGroup:
        return self._groups.rename_group(group_id, name)

    def archive_group(self, group_id: uuid.UUID) -> PartyGroup:
        return self._groups.archive_group(group_id)

    def group_name(self, group_id: uuid.UUID | None) -> str:
        if group_id is None:
            return ""
        group = self._groups.get_group(group_id)
        return group.name if group is not None else ""

    # --- excel ---

    def export(
        self,
        scope: ExportScope,
        path: str | Path,
        *,
        include_archived: bool = False,
        overwrite: bool = False,
    ) -> Path:
        parties = self._parties.list_parties(include_archived=include_archived)
        exporter = PartyExcelExporter(group_name_resolver=lambda p: self.group_name(p.group_id))
        return exporter.export(parties, scope, path, overwrite=overwrite)

    def build_import_preview(self, path: str | Path, *, import_as: ImportAs) -> ImportPreview:
        importer = PartyExcelImporter(self._parties)
        return importer.build_preview(path, import_as=import_as)

    def commit_import(self, preview: ImportPreview) -> ImportResult:
        importer = PartyExcelImporter(self._parties)
        return importer.commit(preview)
