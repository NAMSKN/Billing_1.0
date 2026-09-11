"""Restore workflow: capture trusted numbering state, validate, restore (Task 54).

Restoring an older backup can silently reintroduce invoice numbers that were
already issued after the backup was taken. D-029 requires reconciliation to be
driven by the trusted numbering high-water state captured from the CURRENT
database immediately before restore — never by the high-water mark inside the
(older) backup.

This module implements the Task 54 slice of that workflow:

1. Capture the current per-scope numbering high-water state.
2. Persist it as reconciliation metadata *outside* the database file so it
   survives the database being replaced.
3. Validate the backup package (integrity/tamper — Task 53).
4. Restore atomically by replacing the live database file with the package's
   consistent snapshot, only when the package is valid.

Numbering reconciliation itself (advancing sequences, blocking issuance while
``RECONCILIATION_PENDING``) is Task 56; the safety backup is Task 55; failure
recovery is Task 57. This module records that reconciliation is pending and
preserves the trusted state those tasks consume.

References: requirements Req 15.3; DECISIONS D-018, D-019, D-029.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import uuid
import zipfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.unit_of_work import UnitOfWork
from invoice_generator.infrastructure.backup.backup import create_backup
from invoice_generator.infrastructure.backup.manifest import (
    DATABASE_ENTRY,
    validate_package,
)

RECONCILIATION_METADATA_SUFFIX = ".reconciliation.json"
SAFETY_BACKUP_PREFIX = "pre-restore-"
METADATA_VERSION = 1


class RestoreError(Exception):
    """Raised when a backup cannot be restored (e.g. it fails validation)."""


@dataclass(frozen=True)
class ScopeHighWater:
    """Trusted high-water mark for one numbering scope (company/FY/prefix)."""

    company_id: str
    financial_year: str
    prefix: str
    high_water_mark: int


@dataclass(frozen=True)
class ReconciliationMetadata:
    """Pre-restore trusted numbering state, preserved outside the DB file.

    ``reconciliation_pending`` stays ``True`` until Task 56 advances each scope's
    sequence past its trusted high-water mark and the user confirms.
    """

    metadata_version: int
    reconciliation_pending: bool
    scopes: tuple[ScopeHighWater, ...]

    def to_json(self) -> str:
        payload = {
            "metadata_version": self.metadata_version,
            "reconciliation_pending": self.reconciliation_pending,
            "scopes": [asdict(s) for s in self.scopes],
        }
        return json.dumps(payload, indent=2, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> ReconciliationMetadata:
        data = json.loads(text)
        scopes = tuple(
            ScopeHighWater(
                company_id=str(s["company_id"]),
                financial_year=str(s["financial_year"]),
                prefix=str(s["prefix"]),
                high_water_mark=int(s["high_water_mark"]),
            )
            for s in data["scopes"]
        )
        return cls(
            metadata_version=int(data["metadata_version"]),
            reconciliation_pending=bool(data["reconciliation_pending"]),
            scopes=scopes,
        )


@dataclass(frozen=True)
class RestoreResult:
    """Outcome of a restore: preserved trusted state and the safety backup path."""

    metadata: ReconciliationMetadata
    safety_backup: Path


def reconciliation_metadata_path(database: str | Path) -> Path:
    """Return the path of the reconciliation metadata file for a database."""
    db_path = Path(database)
    return db_path.with_name(db_path.name + RECONCILIATION_METADATA_SUFFIX)


def create_safety_backup(
    database: str | Path,
    safety_backup_dir: str | Path,
    *,
    timestamp: str | None = None,
) -> Path:
    """Create a consistent safety backup of the current database before restore.

    Uses the online backup API (never a raw copy) so the safety backup is a
    consistent snapshot of the live database. The filename is timestamped so an
    existing safety backup is never silently overwritten (Req 15.3).

    Args:
        database: Path to the live SQLite database to preserve.
        safety_backup_dir: Directory to write the safety backup into.
        timestamp: Optional filename timestamp (injected for deterministic
            tests); defaults to the current UTC time (compact ISO form).

    Returns:
        The path of the created safety backup file.
    """
    stamp = timestamp if timestamp is not None else _utc_stamp()
    target_dir = Path(safety_backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = target_dir / f"{SAFETY_BACKUP_PREFIX}{stamp}.db"
    # Guard against an accidental collision within the same second.
    counter = 1
    while destination.exists():
        destination = target_dir / f"{SAFETY_BACKUP_PREFIX}{stamp}-{counter}.db"
        counter += 1
    return create_backup(database, destination)


def _utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def capture_trusted_state(database: str | Path) -> tuple[ScopeHighWater, ...]:
    """Read the current per-scope numbering high-water marks from the live DB.

    Read-only; opens its own short-lived connection. Returns an empty tuple if
    the numbering table does not exist yet (fresh database).
    """
    conn = sqlite3.connect(Path(database))
    try:
        try:
            rows = conn.execute(
                "SELECT company_id, financial_year, prefix, high_water_mark "
                "FROM invoice_sequences"
            ).fetchall()
        except sqlite3.OperationalError:
            return ()
    finally:
        conn.close()
    return tuple(
        ScopeHighWater(
            company_id=str(company_id),
            financial_year=str(financial_year),
            prefix=str(prefix),
            high_water_mark=int(high_water_mark),
        )
        for company_id, financial_year, prefix, high_water_mark in rows
    )


def write_reconciliation_metadata(
    database: str | Path,
    scopes: Sequence[ScopeHighWater],
    *,
    reconciliation_pending: bool = True,
) -> Path:
    """Persist trusted numbering state beside (outside) the database file."""
    metadata = ReconciliationMetadata(
        metadata_version=METADATA_VERSION,
        reconciliation_pending=reconciliation_pending,
        scopes=tuple(scopes),
    )
    path = reconciliation_metadata_path(database)
    path.write_text(metadata.to_json(), encoding="utf-8")
    return path


def read_reconciliation_metadata(database: str | Path) -> ReconciliationMetadata | None:
    """Read reconciliation metadata for a database, or ``None`` if absent."""
    path = reconciliation_metadata_path(database)
    if not path.exists():
        return None
    return ReconciliationMetadata.from_json(path.read_text(encoding="utf-8"))


class MetadataReconciliationGate:
    """Reconciliation gate backed by the on-disk metadata file (D-029).

    Implements :class:`ReconciliationGate`: reports numbering issuance as blocked
    whenever the preserved reconciliation metadata for the database is present
    and still pending. Read fresh each call so clearing the flag immediately
    unblocks issuance.
    """

    def __init__(self, database: str | Path) -> None:
        self._database = database

    def is_reconciliation_pending(self) -> bool:
        metadata = read_reconciliation_metadata(self._database)
        return metadata is not None and metadata.reconciliation_pending


def reconcile_after_restore(
    connection: sqlite3.Connection,
    numbering_service: NumberingService,
    database: str | Path,
) -> ReconciliationMetadata:
    """Reconcile numbering after a restore using the preserved trusted state.

    For each captured pre-restore scope, advances the restored database's
    sequence so the next number is at least ``trusted_high_water_mark + 1``
    (DECISIONS D-029), each scope independently. Runs in one transaction the
    caller-owned way (D-026), then clears the pending flag so issuance is
    allowed again (the Q-009 safe interim: block until explicit confirmation).

    Returns the updated (no-longer-pending) metadata. A no-op (still returns
    cleared metadata) if there is nothing captured or nothing pending.
    """
    metadata = read_reconciliation_metadata(database)
    if metadata is None:
        return ReconciliationMetadata(
            metadata_version=METADATA_VERSION,
            reconciliation_pending=False,
            scopes=(),
        )

    with UnitOfWork(connection):
        for scope in metadata.scopes:
            numbering_service.reconcile_scope(
                uuid.UUID(scope.company_id),
                scope.financial_year,
                scope.prefix,
                scope.high_water_mark,
            )

    write_reconciliation_metadata(database, metadata.scopes, reconciliation_pending=False)
    return ReconciliationMetadata(
        metadata_version=METADATA_VERSION,
        reconciliation_pending=False,
        scopes=metadata.scopes,
    )


def restore_backup(
    package: str | Path,
    *,
    database: str | Path,
    safety_backup_dir: str | Path | None = None,
) -> RestoreResult:
    """Restore ``package`` over the live ``database`` following D-029 (Tasks 54-55).

    Steps: capture current trusted numbering state → persist it outside the DB
    (survives replacement) → safety-backup the current DB → validate the package
    → atomically replace the live database with the package's snapshot.
    Reconciliation stays pending for a later task to complete.

    Args:
        package: Path to the backup package (``.zip``) produced by Task 53.
        database: Path to the live SQLite database file to replace.
        safety_backup_dir: Directory for the pre-restore safety backup; defaults
            to the database's own directory when not supplied.

    Returns:
        A :class:`RestoreResult` with the preserved reconciliation metadata and
        the path of the safety backup taken before restoring.

    Raises:
        RestoreError: if the package fails validation; the live database is left
            untouched. The safety backup (taken first) is retained regardless.
    """
    db_path = Path(database)
    backup_dir = Path(safety_backup_dir) if safety_backup_dir is not None else db_path.parent

    # 1. Capture trusted state from the CURRENT db (D-029) and preserve it
    #    outside the DB file *before* validation so it exists even if the
    #    process is interrupted after this point.
    trusted = capture_trusted_state(db_path)
    write_reconciliation_metadata(db_path, trusted, reconciliation_pending=True)

    # 2. Safety-backup the current database before any overwrite (Req 15.3,
    #    D-029): a consistent snapshot so nothing is lost silently.
    safety_backup = create_safety_backup(db_path, backup_dir)

    # 3. Validate the package; reject an invalid/tampered backup (Req 15.3).
    result = validate_package(package)
    if not result.ok:
        raise RestoreError(f"backup validation failed: {'; '.join(result.errors)}")

    # 4. Atomically replace the live database with the package's snapshot.
    _atomic_replace_from_package(package, db_path)

    metadata = read_reconciliation_metadata(db_path) or ReconciliationMetadata(
        metadata_version=METADATA_VERSION,
        reconciliation_pending=True,
        scopes=trusted,
    )
    return RestoreResult(metadata=metadata, safety_backup=safety_backup)


def _atomic_replace_from_package(package: str | Path, db_path: Path) -> None:
    """Extract the snapshot and atomically move it into place."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # Extract to a temp file on the same filesystem as the target so os.replace
    # is atomic, then swap it in in one step.
    fd, tmp_name = tempfile.mkstemp(dir=db_path.parent, suffix=".restore")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with zipfile.ZipFile(Path(package), "r") as archive:
            tmp_path.write_bytes(archive.read(DATABASE_ENTRY))
        _assert_sqlite_ok(tmp_path)
        os.replace(tmp_path, db_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _assert_sqlite_ok(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
    finally:
        conn.close()
    if row is None or row[0] != "ok":
        raise RestoreError("restored database failed integrity check")


__all__ = [
    "METADATA_VERSION",
    "RECONCILIATION_METADATA_SUFFIX",
    "SAFETY_BACKUP_PREFIX",
    "MetadataReconciliationGate",
    "ReconciliationMetadata",
    "RestoreError",
    "RestoreResult",
    "ScopeHighWater",
    "capture_trusted_state",
    "create_safety_backup",
    "read_reconciliation_metadata",
    "reconcile_after_restore",
    "reconciliation_metadata_path",
    "restore_backup",
    "write_reconciliation_metadata",
]
