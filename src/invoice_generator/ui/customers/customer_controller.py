"""Customer screen controller (Task 47).

Holds customer use-case logic behind the PySide6 widget so the widget stays
thin (no SQL, no business rules — DECISIONS D-021). Supports listing active
customers, add/edit with offline format validation, and archiving (Req 2).
Archived customers (``is_active = false``) are excluded from new-invoice
selection but remain retrievable for history (Req 2.6/2.7).

References: requirements Req 2; DECISIONS D-021.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from invoice_generator.domain.models import Customer
from invoice_generator.domain.repositories import CustomerRepository
from invoice_generator.domain.validation import (
    Issue,
    Severity,
    ValidationResult,
    is_valid_email,
    is_valid_gstin,
)


class CustomerController:
    def __init__(self, customer_repository: CustomerRepository) -> None:
        self._customers = customer_repository

    def list_customers(self) -> Sequence[Customer]:
        """Return active customers for the list screen (archived excluded)."""
        return self._customers.list_active()

    def customers_for_selection(self) -> Sequence[Customer]:
        """Active customers available when creating a new invoice (Req 2.6)."""
        return self._customers.list_active()

    def get(self, customer_id: uuid.UUID) -> Customer | None:
        return self._customers.get(customer_id)

    def validate(self, customer: Customer) -> ValidationResult:
        """Validate a customer for saving (name required; formats checked)."""
        issues: list[Issue] = []
        if not customer.name.strip():
            issues.append(Issue("customer.name", "customer name is required", Severity.BLOCKING))
        if not customer.bill_to.line.strip():
            issues.append(
                Issue("customer.bill_to", "billing address is required", Severity.WARNING)
            )
        if customer.gstin and not is_valid_gstin(customer.gstin):
            issues.append(Issue("customer.gstin", "GSTIN format is invalid", Severity.BLOCKING))
        if customer.email and not is_valid_email(customer.email):
            issues.append(Issue("customer.email", "email format is invalid", Severity.BLOCKING))
        return ValidationResult(tuple(issues))

    def save(self, customer: Customer) -> ValidationResult:
        """Validate and persist a customer; persists only if not blocking."""
        result = self.validate(customer)
        if result.is_ok:
            self._customers.save(customer)
        return result

    def archive(self, customer_id: uuid.UUID) -> Customer | None:
        """Mark a customer inactive (soft-archive); returns the updated customer.

        Archiving preserves the record and its UUID (Req 2.7); it does not
        delete. Returns ``None`` if the customer does not exist.
        """
        customer = self._customers.get(customer_id)
        if customer is None:
            return None
        archived = customer.model_copy(update={"is_active": False})
        self._customers.save(archived)
        return archived


__all__ = ["CustomerController"]
