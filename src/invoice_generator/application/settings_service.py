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

from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.repositories import SettingsRepository

_NUMBERING_KEY = "numbering_config"


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
