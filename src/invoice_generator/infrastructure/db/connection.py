"""SQLite connection helper.

Opens connections with foreign-key enforcement enabled (SQLite disables it per
connection by default) and a row factory for name-based access. Parameterized
queries only (steering); this module never interpolates user input into SQL.

References: requirements Req 23.2, 23.3; design section 7.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def connect(database: str | Path) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys enabled and Row factory.

    Args:
        database: Filesystem path to the database file, or ``":memory:"``.
    """
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
