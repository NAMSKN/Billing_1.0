"""Versioned local asset store (DECISIONS D-019).

Imports an image file (logo/signature/stamp) into the local assets directory,
content-addressed by SHA-256, and returns a versioned :class:`Asset`. Because a
finalized invoice pins the exact asset it used, replacing a logo later creates a
*new* asset version rather than mutating the bytes an old invoice referenced.

The store copies bytes into ``<assets_dir>/<sha256><ext>`` and records the
content hash, version, and stored path on the :class:`Asset`. The domain
:class:`Asset` id is a UUID (DECISIONS D-023); the SHA-256 identifies content.

References: requirements Req 17; DECISIONS D-019, D-023; design sections 25, 27.
"""

from __future__ import annotations

import hashlib
import shutil
from datetime import UTC, datetime
from pathlib import Path

from invoice_generator.domain.ids import IdGenerator, Uuid4Generator
from invoice_generator.domain.models import Asset


class AssetImportError(Exception):
    """Raised when a source asset file cannot be imported."""


class AssetStore:
    def __init__(
        self,
        assets_dir: Path,
        *,
        id_generator: IdGenerator | None = None,
    ) -> None:
        self._dir = assets_dir
        self._ids: IdGenerator = id_generator if id_generator is not None else Uuid4Generator()

    def import_asset(self, source: Path, *, kind: str, version: int = 1) -> Asset:
        """Copy ``source`` into the store and return a versioned :class:`Asset`.

        Args:
            source: Path to the source image file.
            kind: Asset kind, e.g. ``"logo"`` or ``"signature"``.
            version: Version number to record (caller supplies the next value).

        Raises:
            AssetImportError: if ``source`` does not exist or cannot be read.
        """
        if not source.is_file():
            raise AssetImportError(f"asset source not found: {source}")
        try:
            data = source.read_bytes()
        except OSError as exc:
            raise AssetImportError(f"could not read asset: {source}") from exc

        digest = hashlib.sha256(data).hexdigest()
        self._dir.mkdir(parents=True, exist_ok=True)
        stored = self._dir / f"{digest}{source.suffix.lower()}"
        if not stored.exists():
            shutil.copyfile(source, stored)

        return Asset(
            id=self._ids(),
            kind=kind,
            version=version,
            sha256=digest,
            stored_path=str(stored),
            created_at=datetime.now(UTC).isoformat(),
        )


__all__ = ["AssetImportError", "AssetStore"]
