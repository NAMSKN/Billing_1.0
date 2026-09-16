"""Typed application errors for the product master."""

from __future__ import annotations


class ProductServiceError(Exception):
    """Base error for product application-service failures."""


class ProductValidationError(ProductServiceError):
    """Raised when a product fails business validation.

    ``errors`` holds the individual, user-facing messages.
    """

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


class DuplicateProductError(ProductServiceError):
    """Raised when a create would collide with an existing product."""

    def __init__(self, message: str, existing_id: object | None = None) -> None:
        self.existing_id = existing_id
        super().__init__(message)
