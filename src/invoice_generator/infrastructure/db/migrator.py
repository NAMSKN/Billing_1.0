"""Schema migration runner.

Discovers ``NNNN_*.sql`` migration scripts bundled in the migrations package,
orders them deterministically by their integer prefix, and applies those whose
version is greater than the database's current ``schema_version`` (Req 23.4).
Each migration runs in its own transaction and stamps ``schema_version`` on
success, so applying is atomic per migration and idempotent overall.

An existing database is never overwritten because of a version bump: only
migrations newer than the recorded version are applied; already-applied
migrations are skipped, preserving data.

References: requirements Req 23.4; design sections 7, 44, 45.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from importlib import resources

from invoice_generator.infrastructure.db.schema import (
    ensure_schema_version_table,
    get_schema_version,
)

_MIGRATIONS_PACKAGE = "invoice_generator.infrastructure.db.migrations"
_FILENAME_RE = re.compile(r"^(\d+)_.+\.sql$")


@dataclass(frozen=True)
class Migration:
    """A single migration script."""

    version: int
    filename: str
    sql: str


def discover_migrations() -> list[Migration]:
    """Return all bundled migrations ordered by version (ascending).

    Raises:
        ValueError: if two migrations share the same version number.
    """
    root = resources.files(_MIGRATIONS_PACKAGE)
    migrations: list[Migration] = []
    for entry in root.iterdir():
        match = _FILENAME_RE.match(entry.name)
        if match is None:
            continue
        version = int(match.group(1))
        sql = entry.read_text(encoding="utf-8")
        migrations.append(Migration(version=version, filename=entry.name, sql=sql))

    migrations.sort(key=lambda m: m.version)
    check_unique_versions(migrations)
    return migrations


def check_unique_versions(migrations: list[Migration]) -> None:
    """Raise :class:`ValueError` if any two migrations share a version."""
    seen: set[int] = set()
    for migration in migrations:
        if migration.version in seen:
            raise ValueError(f"duplicate migration version: {migration.version}")
        seen.add(migration.version)


def apply_pending(conn: sqlite3.Connection) -> list[int]:
    """Apply migrations newer than the current schema version.

    Each pending migration is applied in its own transaction and stamps
    ``schema_version`` on success. Returns the list of versions applied (empty
    if the database is already up to date).
    """
    ensure_schema_version_table(conn)
    current = get_schema_version(conn)

    applied: list[int] = []
    for migration in discover_migrations():
        if migration.version <= current:
            continue
        with conn:  # commit on success, rollback on error
            conn.executescript(migration.sql)
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?)",
                (migration.version,),
            )
        applied.append(migration.version)

    return applied


def latest_version() -> int:
    """Return the highest bundled migration version (0 if none)."""
    migrations = discover_migrations()
    return migrations[-1].version if migrations else 0
