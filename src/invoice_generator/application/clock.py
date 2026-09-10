"""Clock abstraction for deterministic time in use cases.

Time is injected rather than read directly from :func:`datetime.now` so tests
are deterministic (testing rules). Production wiring uses :class:`SystemClock`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    """Returns the current time as a timezone-aware :class:`datetime`."""

    def now(self) -> datetime: ...


class SystemClock:
    """Default clock returning the current UTC time."""

    def now(self) -> datetime:
        return datetime.now(UTC)


class FixedClock:
    """A clock that always returns a fixed instant (for tests)."""

    def __init__(self, instant: datetime) -> None:
        self._instant = instant

    def now(self) -> datetime:
        return self._instant
