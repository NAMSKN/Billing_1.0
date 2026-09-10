"""Test composition factory (test infrastructure only).

Builds an :class:`Application` via the production composition root
(``bootstrap.build_application``) against a temporary database, with a
deterministic id generator and a fixed clock. Integration tests use this so
they exercise the same wiring the application uses, never a hand-rolled
incompatible arrangement (Task 43).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from invoice_generator.application.clock import Clock, FixedClock
from invoice_generator.bootstrap import Application, build_application
from invoice_generator.domain.ids import IdGenerator
from tests.support.id_factory import SequentialIdGenerator

DEFAULT_CLOCK_INSTANT = datetime(2026, 5, 11, 9, 0, tzinfo=UTC)


def build_test_app(
    tmp_path: Path,
    *,
    id_generator: IdGenerator | None = None,
    clock: Clock | None = None,
) -> Application:
    """Return a wired :class:`Application` on a temp DB with deterministic deps."""
    return build_application(
        tmp_path / "invoices.db",
        id_generator=id_generator if id_generator is not None else SequentialIdGenerator(start=1),
        clock=clock if clock is not None else FixedClock(DEFAULT_CLOCK_INSTANT),
    )
