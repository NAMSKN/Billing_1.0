"""Settings service: load/save invoice-numbering configuration.

Persists the :class:`NumberingConfig` through the generic
:class:`SettingsRepository` port as a JSON value. When no configuration has
been saved yet, the documented default config is returned (Q-002/Q-003/Q-004
safe interims), so a fresh install can number invoices without extra setup.

The service depends on the port only (DECISIONS D-021) and does not manage
transactions itself; the caller commits.

References: requirements Req 10.1, 10.3, 10.7; design sections 9, 33.
"""

from __future__ import annotations

import json
from decimal import Decimal

from invoice_generator.domain.models import TaxRateConfig
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.repositories import SettingsRepository

_NUMBERING_KEY = "numbering_config"
_TAX_KEY = "tax_rate_config"

#: V1 default GST configuration: 18% total, split 9% CGST + 9% SGST, 18% IGST
#: (DECISIONS D-030). Persisted component rates; not derived by halving.
_DEFAULT_TAX = TaxRateConfig(
    total_rate=Decimal("18"),
    cgst_rate=Decimal("9"),
    sgst_rate=Decimal("9"),
    igst_rate=Decimal("18"),
)


class SettingsService:
    def __init__(self, settings_repository: SettingsRepository) -> None:
        self._settings = settings_repository

    def get_numbering_config(self) -> NumberingConfig:
        """Return the saved numbering config, or the default if none is saved."""
        raw = self._settings.get(_NUMBERING_KEY)
        if raw is None:
            return NumberingConfig()
        data = json.loads(raw)
        return NumberingConfig(
            prefix=str(data["prefix"]),
            pad_width=int(data["pad_width"]),
            start_value=int(data["start_value"]),
            fy_scheme=str(data["fy_scheme"]),
        )

    def save_numbering_config(self, config: NumberingConfig) -> None:
        """Persist the numbering config as JSON."""
        payload = {
            "prefix": config.prefix,
            "pad_width": config.pad_width,
            "start_value": config.start_value,
            "fy_scheme": config.fy_scheme,
        }
        self._settings.set(_NUMBERING_KEY, json.dumps(payload))

    def get_tax_rate_config(self) -> TaxRateConfig:
        """Return the saved GST component-rate config, or the V1 default.

        Uses explicit component rates (DECISIONS D-030). Persisting a custom
        configuration is wired with the settings UI; the exact configuration UX
        is OPEN_QUESTIONS Q-005.
        """
        raw = self._settings.get(_TAX_KEY)
        if raw is None:
            return _DEFAULT_TAX
        data = json.loads(raw)
        return TaxRateConfig(
            total_rate=Decimal(str(data["total_rate"])),
            cgst_rate=Decimal(str(data["cgst_rate"])),
            sgst_rate=Decimal(str(data["sgst_rate"])),
            igst_rate=Decimal(str(data["igst_rate"])),
        )

    def save_tax_rate_config(self, config: TaxRateConfig) -> None:
        """Persist the GST component-rate config as JSON."""
        payload = {
            "total_rate": str(config.total_rate),
            "cgst_rate": str(config.cgst_rate),
            "sgst_rate": str(config.sgst_rate),
            "igst_rate": str(config.igst_rate),
        }
        self._settings.set(_TAX_KEY, json.dumps(payload))
