"""Backup packaging and integrity manifest (Task 53).

A backup is a self-contained package (a ZIP archive) holding the database
snapshot, the required asset files, and a ``manifest.json`` describing schema/app
version plus a per-file integrity record (size and SHA-256). This lets a later
restore detect corruption or tampering before touching live data (DECISIONS
D-018, D-019).

The database snapshot is produced with the online backup API from
:mod:`invoice_generator.infrastructure.backup.backup` (never a raw copy), so the
packaged database is a consistent snapshot.

References: requirements Req 15.2; DECISIONS D-018, D-019.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from invoice_generator.infrastructure.backup.backup import create_backup

MANIFEST_NAME = "manifest.json"
DATABASE_ENTRY = "database.db"
ASSETS_PREFIX = "assets/"
MANIFEST_VERSION = 1

_READ_CHUNK = 65536


@dataclass(frozen=True)
class FileEntry:
    """Integrity record for one packaged file."""

    path: str
    size: int
    sha256: str


@dataclass(frozen=True)
class BackupManifest:
    """Describes a backup package's contents and integrity."""

    manifest_version: int
    schema_version: int
    app_version: str
    created_at: str
    files: tuple[FileEntry, ...]

    def to_json(self) -> str:
        payload = asdict(self)
        payload["files"] = [asdict(f) for f in self.files]
        return json.dumps(payload, indent=2, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> BackupManifest:
        data = json.loads(text)
        files = tuple(
            FileEntry(path=f["path"], size=int(f["size"]), sha256=f["sha256"])
            for f in data["files"]
        )
        return cls(
            manifest_version=int(data["manifest_version"]),
            schema_version=int(data["schema_version"]),
            app_version=str(data["app_version"]),
            created_at=str(data["created_at"]),
            files=files,
        )


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of validating a backup package's integrity."""

    ok: bool
    errors: tuple[str, ...]


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash_file(path: Path) -> tuple[int, str]:
    """Return ``(size, sha256_hex)`` for a file, streamed to bound memory."""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(_READ_CHUNK):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def create_package(
    *,
    source_db: str | Path,
    asset_files: Iterable[str | Path] = (),
    schema_version: int,
    app_version: str,
    destination: str | Path,
    created_at: str | None = None,
) -> Path:
    """Build a backup package (ZIP) with a consistent DB snapshot and manifest.

    Args:
        source_db: Path to the live SQLite database to snapshot.
        asset_files: Paths to required asset files to include (D-019).
        schema_version: Current database schema version.
        app_version: Application version string.
        destination: Path to write the ``.zip`` package to.
        created_at: Optional ISO timestamp (injected for deterministic tests);
            defaults to the current UTC time.

    Returns:
        The destination package path.
    """
    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if destination_path.exists():
        destination_path.unlink()

    stamp = created_at if created_at is not None else datetime.now(UTC).isoformat()

    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        snapshot = create_backup(source_db, work_dir / DATABASE_ENTRY)

        entries: list[FileEntry] = []
        db_size, db_hash = _hash_file(snapshot)
        entries.append(FileEntry(path=DATABASE_ENTRY, size=db_size, sha256=db_hash))

        staged_assets: list[tuple[str, Path]] = []
        for asset in _unique_assets(asset_files):
            arcname = f"{ASSETS_PREFIX}{asset.name}"
            size, digest = _hash_file(asset)
            entries.append(FileEntry(path=arcname, size=size, sha256=digest))
            staged_assets.append((arcname, asset))

        manifest = BackupManifest(
            manifest_version=MANIFEST_VERSION,
            schema_version=schema_version,
            app_version=app_version,
            created_at=stamp,
            files=tuple(entries),
        )

        with zipfile.ZipFile(destination_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot, DATABASE_ENTRY)
            for arcname, asset in staged_assets:
                archive.write(asset, arcname)
            archive.writestr(MANIFEST_NAME, manifest.to_json())

    return destination_path


def _unique_assets(asset_files: Iterable[str | Path]) -> list[Path]:
    """Resolve asset paths, de-duplicating by archive name (basename)."""
    seen: set[str] = set()
    result: list[Path] = []
    for raw in asset_files:
        path = Path(raw)
        if path.name in seen:
            continue
        seen.add(path.name)
        result.append(path)
    return result


def read_manifest(package_path: str | Path) -> BackupManifest:
    """Read and parse the manifest from a backup package."""
    with zipfile.ZipFile(Path(package_path), "r") as archive:
        text = archive.read(MANIFEST_NAME).decode("utf-8")
    return BackupManifest.from_json(text)


def validate_package(package_path: str | Path) -> ValidationResult:
    """Validate a backup package against its manifest.

    Detects tampering or corruption: a missing manifest, a missing packaged
    file, a size/hash mismatch, or unexpected extra files. Returns a result
    listing every problem found (never raises for integrity failures).
    """
    path = Path(package_path)
    if not path.exists():
        return ValidationResult(ok=False, errors=(f"package not found: {path}",))

    errors: list[str] = []
    try:
        with zipfile.ZipFile(path, "r") as archive:
            names = set(archive.namelist())
            if MANIFEST_NAME not in names:
                return ValidationResult(ok=False, errors=("manifest missing from package",))
            manifest = BackupManifest.from_json(archive.read(MANIFEST_NAME).decode("utf-8"))

            _validate_entries(archive, manifest.files, errors)
            _report_unexpected(names, manifest.files, errors)
    except zipfile.BadZipFile:
        return ValidationResult(ok=False, errors=("package is not a valid archive",))

    return ValidationResult(ok=not errors, errors=tuple(errors))


def _validate_entries(
    archive: zipfile.ZipFile,
    files: Sequence[FileEntry],
    errors: list[str],
) -> None:
    names = set(archive.namelist())
    for entry in files:
        if entry.path not in names:
            errors.append(f"missing file: {entry.path}")
            continue
        data = archive.read(entry.path)
        if len(data) != entry.size:
            errors.append(f"size mismatch: {entry.path}")
        if _hash_bytes(data) != entry.sha256:
            errors.append(f"hash mismatch: {entry.path}")


def _report_unexpected(
    names: set[str],
    files: Sequence[FileEntry],
    errors: list[str],
) -> None:
    expected = {entry.path for entry in files} | {MANIFEST_NAME}
    for name in sorted(names - expected):
        if name.endswith("/"):  # directory entries are not payload files
            continue
        errors.append(f"unexpected file: {name}")


__all__ = [
    "ASSETS_PREFIX",
    "DATABASE_ENTRY",
    "MANIFEST_NAME",
    "MANIFEST_VERSION",
    "BackupManifest",
    "FileEntry",
    "ValidationResult",
    "create_package",
    "read_manifest",
    "validate_package",
]
