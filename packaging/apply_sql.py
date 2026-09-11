"""Apply a .sql script to a SQLite database using Python's built-in sqlite3.

A no-install alternative to the standalone `sqlite3` CLI. Runs the SQL script
against the target database (defaults to the app's per-user database).

Usage:
    python packaging/apply_sql.py packaging/seed_reference_data.sql
    python packaging/apply_sql.py <script.sql> [database.db]

If the database path is omitted, the app's default location is used:
    Windows: %LOCALAPPDATA%\\InvoiceGenerator\\database\\invoices.db
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


def _default_db() -> Path:
    from invoice_generator.config.paths import get_app_paths

    return get_app_paths().database_file


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: python packaging/apply_sql.py <script.sql> [database.db]")
        return 2

    script_path = Path(argv[0])
    if not script_path.is_file():
        print(f"SQL script not found: {script_path}")
        return 1

    db_path = Path(argv[1]) if len(argv) > 1 else _default_db()
    if not db_path.exists():
        print(
            f"Database not found: {db_path}\n"
            "Launch the application once (which creates the database) before seeding."
        )
        return 1

    sql = script_path.read_text(encoding="utf-8")
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(sql)
        conn.commit()
    finally:
        conn.close()

    print(f"Applied {script_path.name} to {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
