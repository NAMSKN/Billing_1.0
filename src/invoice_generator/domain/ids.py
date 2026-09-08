"""Entity identity: application-generated UUID4 ids.

Every persistent domain entity uses a UUID4 as its internal id, generated in
the domain/application layer (never SQLite AUTOINCREMENT) — DECISIONS D-023.
Ids are stored as canonical lowercase hyphenated TEXT (D-024). The invoice
UUID is distinct from the human-readable invoice number (D-025); this module
concerns only the internal UUID identity.

Generation is done through an injectable :class:`IdGenerator` so tests can be
deterministic without monkeypatching the ``uuid`` module (DECISIONS D-023).
Production wiring uses :class:`Uuid4Generator`.

Canonical form (D-024): lowercase, hyphenated, 36 characters, e.g.
``550e8400-e29b-41d4-a716-446655440000``. Non-canonical spellings that
:func:`uuid.UUID` would otherwise accept (uppercase, ``{...}`` braces, or a
``urn:uuid:`` prefix) are rejected by :func:`validate_canonical` so that
storage stays consistent.

This module is pure: no I/O, no global state.

References: requirements Req 30; DECISIONS D-023, D-024, D-025; design section 3.
"""

from __future__ import annotations

import uuid
from typing import Protocol, runtime_checkable


@runtime_checkable
class IdGenerator(Protocol):
    """Callable that produces a new entity id.

    Injected into services/repositories that create entities. The default is
    :class:`Uuid4Generator`; tests may supply a deterministic generator.
    """

    def __call__(self) -> uuid.UUID: ...


class Uuid4Generator:
    """Default :class:`IdGenerator` returning random UUID4 values."""

    def __call__(self) -> uuid.UUID:
        return uuid.uuid4()


def new_id(generator: IdGenerator | None = None) -> uuid.UUID:
    """Return a new UUID from ``generator`` (defaults to UUID4)."""
    gen = generator if generator is not None else Uuid4Generator()
    return gen()


def to_canonical(value: uuid.UUID | str) -> str:
    """Return the canonical lowercase hyphenated string for ``value``.

    Accepts a :class:`uuid.UUID` or a string the standard library can parse,
    and normalizes it to canonical form. Use this when serializing to storage.
    """
    if isinstance(value, uuid.UUID):
        return str(value)
    # Parse then re-serialize to guarantee canonical output.
    return str(uuid.UUID(value))


def is_canonical(value: str) -> bool:
    """Return True if ``value`` is already in canonical lowercase form."""
    if not isinstance(value, str):
        return False
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return str(parsed) == value


def validate_canonical(value: str) -> str:
    """Return ``value`` if it is a canonical UUID string, else raise.

    Used at the repository boundary to reject non-canonical spellings
    (uppercase, braces, ``urn:uuid:`` prefix, malformed strings).
    """
    if not is_canonical(value):
        raise ValueError(f"not a canonical lowercase UUID string: {value!r}")
    return value


def parse_uuid(value: str) -> uuid.UUID:
    """Parse a canonical UUID string into a :class:`uuid.UUID`.

    Rejects non-canonical spellings so parsing and storage stay consistent.
    """
    validate_canonical(value)
    return uuid.UUID(value)
