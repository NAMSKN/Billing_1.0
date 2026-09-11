"""Typed application errors for the party master."""

from __future__ import annotations


class PartyServiceError(Exception):
    """Base error for party application-service failures."""


class PartyValidationError(PartyServiceError):
    """Raised when a party fails business validation.

    ``errors`` holds the individual, user-facing messages.
    """

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


class DuplicatePartyError(PartyServiceError):
    """Raised when a create would collide with an existing party."""

    def __init__(self, message: str, existing_id: object | None = None) -> None:
        self.existing_id = existing_id
        super().__init__(message)
