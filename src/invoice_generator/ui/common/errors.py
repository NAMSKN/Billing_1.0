"""UI error boundary: friendly messages + local logging (Task 45).

Converts exceptions raised by the application/services into concise,
business-friendly messages for the operator, and logs the full technical
detail (including a traceback) to the local application log. Raw stack traces
are never surfaced in the UI (Req 25.4). Logging is local only and must not
include secrets/PII (Req 25.5); callers pass exceptions whose messages avoid
sensitive values.

The core is pure/headless (message mapping + logging). Showing a dialog is a
thin optional wrapper so the boundary is testable without a display.
"""

from __future__ import annotations

import logging

from invoice_generator.application.errors import ApplicationError
from invoice_generator.config.logging_setup import get_logger

_GENERIC_MESSAGE = "An unexpected error occurred. Please try again."


def to_user_message(exc: BaseException) -> str:
    """Return a business-friendly message for ``exc`` (never a stack trace)."""
    if isinstance(exc, ApplicationError):
        return exc.user_message
    return _GENERIC_MESSAGE


def log_error(
    exc: BaseException, *, context: str = "", logger: logging.Logger | None = None
) -> None:
    """Log the full technical detail of ``exc`` (with traceback) locally."""
    log = logger if logger is not None else get_logger("ui")
    prefix = f"{context}: " if context else ""
    log.error("%s%s", prefix, exc, exc_info=exc)


def report_error(
    exc: BaseException,
    *,
    context: str = "",
    logger: logging.Logger | None = None,
) -> str:
    """Log ``exc`` and return the user-facing message to display.

    This is the boundary used by controllers: it records technical detail in the
    log and hands back a safe message. Displaying it (e.g. in a dialog) is the
    caller's concern; see :func:`show_error_dialog`.
    """
    log_error(exc, context=context, logger=logger)
    return to_user_message(exc)


def show_error_dialog(parent: object, exc: BaseException, *, context: str = "") -> str:
    """Log ``exc`` and show its friendly message in a modal dialog.

    Imports Qt lazily so this module stays importable without a display. Returns
    the message shown (useful for tests/callers).
    """
    message = report_error(exc, context=context)
    from PySide6.QtWidgets import QMessageBox, QWidget

    box_parent = parent if isinstance(parent, QWidget) else None
    QMessageBox.warning(box_parent, "Invoice Generator", message)
    return message


__all__ = ["log_error", "report_error", "show_error_dialog", "to_user_message"]
