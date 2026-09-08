"""Validation infrastructure: draft (permissive) vs finalization (strict).

Two distinct validation paths (design section 10, finding 3.1):

- :func:`validate_draft` is permissive. A draft may be incomplete; missing
  required data is reported as a non-blocking **warning**, not an error, so the
  operator can save work in progress (Req 8). Data that is *present but
  malformed* (e.g. an invalid GSTIN) is still flagged.
- :func:`validate_for_finalization` is strict. It enforces every required
  business rule in the documented order (Req 9.1) and returns **blocking**
  issues that prevent finalization.

Format validators (GSTIN, email, IFSC) are offline/format-only — no network
call is ever made (Req 1.4, 2.3, 24.3).

Future-dated invoices are treated as a non-blocking warning pending decision
(OPEN_QUESTIONS Q-001); this module does not hard-block them.

This module is pure: no I/O, no clock, no global state. Callers pass any
"today" reference date explicitly.

References: requirements Req 1.4, 2.3, 3.4, 4.5, 8, 9, 20.3, 24.3; design
sections 10, 21; OPEN_QUESTIONS Q-001.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum

from invoice_generator.domain.enums import TaxTreatment
from invoice_generator.domain.models import Company, Customer, Invoice, InvoiceLine

# --- Offline format patterns ---

# GSTIN: 2-digit state code, 10-char PAN, 1 entity digit, 'Z', 1 checksum char.
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
# IFSC: 4 letters, '0', 6 alphanumerics.
_IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
# Pragmatic offline email check (not a full RFC validator).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_gstin(value: str) -> bool:
    """Return True if ``value`` matches the GSTIN format (offline)."""
    return bool(_GSTIN_RE.match(value))


def is_valid_ifsc(value: str) -> bool:
    """Return True if ``value`` matches the IFSC format (offline)."""
    return bool(_IFSC_RE.match(value))


def is_valid_email(value: str) -> bool:
    """Return True if ``value`` looks like an email address (offline)."""
    return bool(_EMAIL_RE.match(value))


# --- Issue model ---


class Severity(StrEnum):
    """Severity of a validation issue."""

    BLOCKING = "BLOCKING"
    WARNING = "WARNING"


@dataclass(frozen=True)
class Issue:
    """A single validation issue tied to a field."""

    field: str
    message: str
    severity: Severity


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of a validation pass."""

    issues: tuple[Issue, ...] = ()

    @property
    def blocking(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.severity is Severity.BLOCKING)

    @property
    def warnings(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.severity is Severity.WARNING)

    @property
    def is_ok(self) -> bool:
        """True if there are no blocking issues (warnings are allowed)."""
        return not self.blocking


class _IssueCollector:
    """Mutable helper used to build a :class:`ValidationResult`."""

    def __init__(self) -> None:
        self._issues: list[Issue] = []

    def add(self, issue: Issue) -> None:
        self._issues.append(issue)

    def block(self, field_name: str, message: str) -> None:
        self._issues.append(Issue(field_name, message, Severity.BLOCKING))

    def warn(self, field_name: str, message: str) -> None:
        self._issues.append(Issue(field_name, message, Severity.WARNING))

    def result(self) -> ValidationResult:
        return ValidationResult(tuple(self._issues))


# --- Field-format checks (shared) ---


def _check_optional_formats_company(c: Company, out: _IssueCollector) -> None:
    if c.gstin and not is_valid_gstin(c.gstin):
        out.block("company.gstin", "GSTIN format is invalid")
    if c.email and not is_valid_email(c.email):
        out.block("company.email", "email format is invalid")
    if c.ifsc and not is_valid_ifsc(c.ifsc):
        out.block("company.ifsc", "IFSC format is invalid")


def _check_optional_formats_customer(c: Customer, out: _IssueCollector) -> None:
    if c.gstin and not is_valid_gstin(c.gstin):
        out.block("customer.gstin", "GSTIN format is invalid")
    if c.email and not is_valid_email(c.email):
        out.block("customer.email", "email format is invalid")


# --- Line validation ---


def validate_line(line: InvoiceLine, *, index: int, strict: bool) -> tuple[Issue, ...]:
    """Validate a single line item.

    When ``strict`` (finalization), missing required data is blocking. When not
    strict (draft), the same missing data is a warning; malformed values remain
    blocking either way.
    """
    out = _IssueCollector()
    prefix = f"lines[{index}]"

    def missing(field_name: str, message: str) -> None:
        (out.block if strict else out.warn)(field_name, message)

    if not line.description.strip():
        missing(f"{prefix}.description", "description is required")

    if line.tax_treatment is TaxTreatment.TAXABLE and not line.hsn_sac.strip():
        missing(f"{prefix}.hsn_sac", "HSN/SAC is required for a taxable line")

    # Malformed numeric values are always blocking.
    if line.quantity <= Decimal(0):
        out.block(f"{prefix}.quantity", "quantity must be greater than zero")
    if line.rate < Decimal(0):
        out.block(f"{prefix}.rate", "rate must not be negative")
    if not (Decimal(0) <= line.discount_percent <= Decimal(100)):
        out.block(f"{prefix}.discount_percent", "discount percent must be between 0 and 100")

    return out.result().issues


# --- Date checks ---


def _check_dates(
    invoice_date: date | None,
    due_date: date | None,
    today: date | None,
    out: _IssueCollector,
    *,
    strict: bool,
) -> None:
    if invoice_date is None:
        if strict:
            out.block("invoice_date", "invoice date is required")
        else:
            out.warn("invoice_date", "invoice date is not set")
        return
    if due_date is not None and due_date < invoice_date:
        out.block("due_date", "due date must not be earlier than the invoice date")
    if today is not None and invoice_date > today:
        # Future-dated policy is undecided (Q-001): warn, never hard-block.
        out.warn("invoice_date", "invoice date is in the future")


# --- Public validators ---


def validate_draft(
    invoice: Invoice,
    *,
    company: Company | None = None,
    customer: Customer | None = None,
    invoice_date: date | None = None,
    due_date: date | None = None,
    today: date | None = None,
) -> ValidationResult:
    """Permissive validation for saving a draft (Req 8).

    Missing required data yields warnings; malformed present data yields
    blocking issues so obviously bad input is caught early.
    """
    out = _IssueCollector()

    if company is not None:
        _check_optional_formats_company(company, out)
    if customer is not None:
        _check_optional_formats_customer(customer, out)

    _check_dates(invoice_date, due_date, today, out, strict=False)

    if not invoice.lines:
        out.warn("lines", "invoice has no line items")
    for i, line in enumerate(invoice.lines):
        for issue in validate_line(line, index=i, strict=False):
            out.add(issue)

    return out.result()


def validate_for_finalization(
    invoice: Invoice,
    *,
    company: Company,
    customer: Customer,
    invoice_date: date,
    due_date: date | None = None,
    today: date | None = None,
) -> ValidationResult:
    """Strict validation gating finalization (Req 9.1).

    Enforces required company/customer/date/line data in order; all failures
    are blocking. Format problems are blocking too. Place-of-supply/tax
    resolution is performed by the calculation engine and finalization use case
    (later tasks); this validator checks the data those steps require.
    """
    out = _IssueCollector()

    # 1. Company
    if not company.name.strip():
        out.block("company.name", "company name is required")
    _check_optional_formats_company(company, out)

    # 2. Customer
    if not customer.name.strip():
        out.block("customer.name", "customer name is required")
    if not customer.bill_to.line.strip():
        out.block("customer.bill_to", "billing address is required")
    if not customer.bill_to.state_code.strip():
        out.block("customer.bill_to.state_code", "billing state is required")
    _check_optional_formats_customer(customer, out)

    # 3. Invoice date (and due-date ordering)
    _check_dates(invoice_date, due_date, today, out, strict=True)

    # 4. Place of supply (authoritative tax input, Req 11)
    if not invoice.place_of_supply.state_code.strip():
        out.block("place_of_supply.state_code", "place of supply is required")

    # 5. Line items
    if not invoice.lines:
        out.block("lines", "at least one line item is required")
    for i, line in enumerate(invoice.lines):
        for issue in validate_line(line, index=i, strict=True):
            out.add(issue)

    return out.result()
