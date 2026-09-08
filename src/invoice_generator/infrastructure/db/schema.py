"""Schema definition and initial-schema application.

Task 14 provides the initial schema (migration ``0001_initial.sql``) and a
helper to apply it to a connection, plus the ``schema_version`` bookkeeping
table. The general migration runner that applies pending migrations in order is
Task 15; it builds on the ``schema_version`` table created here.

References: requirements Req 23; DECISIONS D-004, D-023, D-024; design section 7.
"""

from __future__ import annotations

import sqlite3
from importlib import resources

#: Schema version reached after applying the initial migration.
INITIAL_SCHEMA_VERSION = 1

_MIGRATIONS_PACKAGE = "invoice_generator.infrastructure.db.migrations"


def _read_migration(filename: str) -> str:
    """Read a migration SQL script bundled in the migrations package."""
    return resources.files(_MIGRATIONS_PACKAGE).joinpath(filename).read_text(encoding="utf-8")


def ensure_schema_version_table(conn: sqlite3.Connection) -> None:
    """Create the ``schema_version`` table if it does not exist."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")


def get_schema_version(conn: sqlite3.Connection) -> int:
    """Return the current schema version (0 if never initialized)."""
    ensure_schema_version_table(conn)
    row = conn.execute("SELECT MAX(version) AS version FROM schema_version").fetchone()
    if row is None or row["version"] is None:
        return 0
    return int(row["version"])


def apply_initial_schema(conn: sqlite3.Connection) -> None:
    """Create all tables from migration 0001 and stamp the schema version.

    Intended for a fresh database. Runs inside a single transaction so a
    partial schema is never left behind.
    """
    ddl = _read_migration("0001_initial.sql")
    ensure_schema_version_table(conn)
    with conn:  # commits on success, rolls back on error
        conn.executescript(ddl)
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (INITIAL_SCHEMA_VERSION,))
