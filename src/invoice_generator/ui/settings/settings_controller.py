"""Settings screen controller (Task 46).

Holds the settings use-case logic behind the PySide6 widget so the widget stays
thin (no SQL, no business rules — DECISIONS D-021). Coordinates: company master
load/save with offline format validation (Req 1), numbering configuration
(Req 10), explicit GST component rates (Req 6.4, DECISIONS D-030), and versioned
logo/signature assets (Req 17) with graceful handling when a file is missing.

References: requirements Req 1, 6.4, 10, 17; DECISIONS D-019, D-030.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.models import Asset, Company, Invoice, TaxRateConfig
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.repositories import AssetRepository, CompanyRepository
from invoice_generator.domain.validation import ValidationResult, validate_draft
from invoice_generator.infrastructure.assets.asset_store import AssetImportError, AssetStore


class SettingsController:
    def __init__(
        self,
        company_repository: CompanyRepository,
        asset_repository: AssetRepository,
        settings_service: SettingsService,
        asset_store: AssetStore,
    ) -> None:
        self._companies = company_repository
        self._assets = asset_repository
        self._settings = settings_service
        self._asset_store = asset_store

    # --- Company ---

    def load_company(self) -> Company:
        """Return the active company, or a blank one if none is configured yet."""
        return self._companies.get_active() or Company()

    def save_company(self, company: Company) -> ValidationResult:
        """Validate company formats and persist. Returns the validation result.

        Uses the permissive validator (format checks on present GSTIN/email/
        IFSC); a blocking result is returned without persisting.
        """
        # validate_draft validates the company argument's formats; the empty
        # Invoice is just the required carrier for that permissive validator.
        result = validate_draft(Invoice(), company=company)
        if result.is_ok:
            self._companies.save(company)
        return result

    # --- Numbering configuration (Req 10) ---

    def load_numbering_config(self) -> NumberingConfig:
        return self._settings.get_numbering_config()

    def save_numbering_config(self, config: NumberingConfig) -> None:
        self._settings.save_numbering_config(config)

    # --- Tax configuration (Req 6.4, D-030) ---

    def load_tax_config(self) -> TaxRateConfig:
        return self._settings.get_tax_rate_config()

    def save_tax_config(self, config: TaxRateConfig) -> None:
        self._settings.save_tax_rate_config(config)

    # --- Versioned assets (Req 17, D-019) ---

    def import_asset(self, source_path: str, *, kind: str) -> Asset | None:
        """Import a logo/signature file as a new versioned asset.

        Returns the persisted :class:`Asset`, or ``None`` if the source file is
        missing/unreadable (graceful handling — the caller shows a warning).
        The version is the next integer for that kind.
        """
        try:
            version = self._next_version(kind)
            asset = self._asset_store.import_asset(Path(source_path), kind=kind, version=version)
        except AssetImportError:
            return None
        self._assets.save(asset)
        return asset

    def resolve_asset(self, asset_id: uuid.UUID | None) -> Asset | None:
        """Return a stored asset by id (or None); missing degrades gracefully."""
        if asset_id is None:
            return None
        return self._assets.get(asset_id)

    def _next_version(self, kind: str) -> int:
        # Versions are per-kind and monotonic; a full history query is not
        # needed for V1, so derive the next version from the current company's
        # pinned asset if present, else 1.
        company = self._companies.get_active()
        current_id = None
        if company is not None:
            current_id = company.logo_asset_id if kind == "logo" else company.signature_asset_id
        current = self.resolve_asset(current_id)
        return (current.version + 1) if current is not None else 1


__all__ = ["SettingsController"]
