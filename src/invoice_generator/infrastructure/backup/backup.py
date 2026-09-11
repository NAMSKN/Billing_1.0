"""Consistent SQLite database backup (Task 52).

Produces a consistent snapshot of the live database using SQLite's online backup
API (:meth:`sqlite3.Connection.backup`), never a raw file copy while the
database may be written (DECISIONS D-018). The online backup API copies pages
under SQLite's own locking, so the resulting file is internally consistent even
if the source is being modified concurrently, and all data — including UUID
entity ids — is preserved byte-for-byte at the row level.

This module produces a single snapshot ``.db`` file. Packaging (assets + version
+ manifest) is layered on top in Task 53; restore is Task 54+.

References: requirements Req 15.1, 30.6; DECISIONS D-018.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def create_backup(source: str | Path, destination: str | Path) -> Path:
    """Write a consistent snapshot of ``source`` to ``destination``.

    Uses the SQLite online backup API so the snapshot is consistent even if the
    source database is being written concurrently (DECISIONS D-018). The
    destination's parent directory is created if it does not exist. Any existing
    destination file is overwritten.

    Args:
        source: Path to the live SQLite database file.
        destination: Path where the snapshot ``.db`` file will be written.

    Returns:
        The destination path.

    Raises:
        FileNotFoundError: If the source database file does not exist.
    """
    source_path = Path(source)
    destination_path = Path(destination)
    if not source_path.exists():
        msg = f"Source database not found: {source_path}"
        raise FileNotFoundError(msg)

    destination_path.parent.mkdir(parents=True, exist_ok=True)

    # A fresh destination avoids merging into a stale file left by a prior run.
    if destination_path.exists():
        destination_path.unlink()

    source_conn = sqlite3.connect(source_path)
    try:
        dest_conn = sqlite3.connect(destination_path)
        try:
            # Online backup API: copies pages under SQLite locking for a
            # consistent snapshot; not a raw file copy (DECISIONS D-018).
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    return destination_path


__all__ = ["create_backup"]
