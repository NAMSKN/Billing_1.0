"""Shared entity identity: application-generated UUID4 ids."""

from __future__ import annotations

import uuid
from typing import Protocol, runtime_checkable

CANONICAL_UUID_LENGTH = 36


@runtime_checkable
class IdGenerator(Protocol):
    """Callable that produces a new entity id."""

    def __call__(self) -> uuid.UUID: ...


class Uuid4Generator:
    """Production id generator returning fresh random UUID4s."""

    def __call__(self) -> uuid.UUID:
        return uuid.uuid4()


class DeterministicIdGenerator:
    """Test id generator returning predetermined sequence of UUIDs."""

    def __init__(self, ids: list[uuid.UUID] | None = None) -> None:
        self._ids = list(ids or [])
        self._index = 0

    def __call__(self) -> uuid.UUID:
        if self._index < len(self._ids):
            val = self._ids[self._index]
            self._index += 1
            return val
        return uuid.uuid4()


def validate_canonical(id_str: str) -> uuid.UUID:
    """Parse a string as a canonical lowercase hyphenated UUID4."""
    if len(id_str) != CANONICAL_UUID_LENGTH:
        raise ValueError(f"UUID must be {CANONICAL_UUID_LENGTH} chars, got {len(id_str)!r}")
    val = uuid.UUID(id_str)
    if str(val) != id_str.lower():
        raise ValueError(f"Non-canonical UUID string: {id_str!r}")
    return val
