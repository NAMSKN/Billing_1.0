"""Shared time provider: Clock protocol for deterministic date/time."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    """Protocol for getting the current system date and time."""

    def now(self) -> datetime: ...
    def today(self) -> date: ...


class SystemClock:
    """Production clock returning real system date and UTC time."""

    def now(self) -> datetime:
        return datetime.now(UTC)

    def today(self) -> date:
        return date.today()


class FrozenClock:
    """Test clock returning fixed datetime / date."""

    def __init__(self, current: datetime | date | None = None) -> None:
        if isinstance(current, datetime):
            self._dt = current
            self._date = current.date()
        elif isinstance(current, date):
            self._dt = datetime.combine(current, datetime.min.time(), tzinfo=UTC)
            self._date = current
        else:
            self._dt = datetime.now(UTC)
            self._date = self._dt.date()

    def now(self) -> datetime:
        return self._dt

    def today(self) -> date:
        return self._date
