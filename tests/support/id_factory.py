"""Deterministic id generators for tests.

Provides :class:`SequentialIdGenerator`, an :class:`IdGenerator` that yields a
predictable sequence of UUIDs so tests can assert on ids without monkeypatching
the ``uuid`` module (DECISIONS D-023). This is test infrastructure only and is
never imported by application code.
"""

from __future__ import annotations

import uuid


class SequentialIdGenerator:
    """Yield deterministic UUIDs of the form ``00000000-0000-4000-8000-0000000000NN``.

    Each call returns the next id in sequence, starting at ``start``. The
    produced values are valid, canonical UUIDs and are stable across runs.
    """

    def __init__(self, start: int = 1) -> None:
        self._next = start

    def __call__(self) -> uuid.UUID:
        value = self._next
        self._next += 1
        # Encode the counter into the node field of a fixed template so the
        # result is a well-formed, canonical UUID.
        return uuid.UUID(f"00000000-0000-4000-8000-{value:012x}")


class FixedIdGenerator:
    """Always return the same UUID (useful for single-entity tests)."""

    def __init__(self, value: uuid.UUID) -> None:
        self._value = value

    def __call__(self) -> uuid.UUID:
        return self._value
