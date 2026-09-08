"""Unit of work: explicit SQLite transaction boundary.

Application use cases own transaction boundaries (DECISIONS D-026). This small
context manager opens the connection's transaction with ``BEGIN IMMEDIATE`` (a
SQLite reserved write lock that serializes writers, D-028 — never
``SELECT ... FOR UPDATE``), commits on success, and rolls back on any error.

Repositories invoked inside the ``with`` block participate in this transaction
and must not commit on their own. The connection is expected to be in
autocommit mode (``isolation_level = None``) so that transaction control is
fully explicit here rather than implicit in :mod:`sqlite3`.

Usage::

    with UnitOfWork(conn):
        repo.save(...)
        other_repo.save(...)
    # committed here; or rolled back if the block raised

References: DECISIONS D-026, D-028; design section 22.
"""

from __future__ import annotations

import sqlite3
from types import TracebackType


class UnitOfWork:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._conn = connection

    def __enter__(self) -> UnitOfWork:
        self._conn.execute("BEGIN IMMEDIATE")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            self._conn.execute("ROLLBACK")
        else:
            self._conn.execute("COMMIT")
