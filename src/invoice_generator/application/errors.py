"""Typed application errors and their user-facing messages.

Defines a small error hierarchy (design section 21). Infrastructure raises
specific errors; services propagate them; the UI boundary
(:mod:`invoice_generator.ui.common.errors`) maps them to friendly messages and
logs technical detail. Business/application code never shows UI dialogs.

Each :class:`ApplicationError` carries a ``user_message`` — a concise,
business-friendly sentence safe to show in the UI (no stack traces, no raw
technical detail). The exception's ``str`` may carry technical context for the
log only.

References: requirements Req 25.4, 25.5; design section 21.
"""

from __future__ import annotations


class ApplicationError(Exception):
    """Base class for expected application errors.

    ``user_message`` is shown to the operator; the exception message (``str``)
    may contain technical detail intended only for the local log.
    """

    default_user_message = "Something went wrong. Please try again."

    def __init__(self, message: str = "", *, user_message: str | None = None) -> None:
        super().__init__(message or self.default_user_message)
        self.user_message = user_message or self.default_user_message


class ValidationError(ApplicationError):
    default_user_message = (
        "Some information is missing or invalid. Please review the highlighted fields."
    )


class NumberingError(ApplicationError):
    default_user_message = "The invoice number could not be assigned. Please try again."


class ReconciliationPendingError(NumberingError):
    default_user_message = (
        "Invoice numbering must be reconciled after the restore before new "
        "invoices can be issued. Please confirm reconciliation to continue."
    )


class FinalizationError(ApplicationError):
    default_user_message = "The invoice could not be finalized. Please review and try again."


class DatabaseError(ApplicationError):
    default_user_message = "A problem occurred accessing local data. Please try again."


class PDFGenerationError(ApplicationError):
    default_user_message = "The PDF could not be generated."


class PrinterError(ApplicationError):
    default_user_message = "The document could not be printed. Please check the printer."


class BackupError(ApplicationError):
    default_user_message = "The backup could not be completed."


class RestoreError(ApplicationError):
    default_user_message = "The backup could not be restored."


__all__ = [
    "ApplicationError",
    "BackupError",
    "DatabaseError",
    "FinalizationError",
    "NumberingError",
    "PDFGenerationError",
    "PrinterError",
    "ReconciliationPendingError",
    "RestoreError",
    "ValidationError",
]
