"""Unit tests for the UI error boundary (Task 45)."""

from __future__ import annotations

import logging

import pytest

from invoice_generator.application.errors import (
    ApplicationError,
    BackupError,
    DatabaseError,
    NumberingError,
    PDFGenerationError,
    PrinterError,
    RestoreError,
    ValidationError,
)
from invoice_generator.ui.common.errors import log_error, report_error, to_user_message

ALL_TYPED = [
    ValidationError,
    NumberingError,
    DatabaseError,
    PDFGenerationError,
    PrinterError,
    BackupError,
    RestoreError,
]


@pytest.mark.parametrize("error_cls", ALL_TYPED)
def test_each_typed_error_maps_to_friendly_message(error_cls: type[ApplicationError]) -> None:
    msg = to_user_message(error_cls("technical detail with id 550e8400"))
    assert msg == error_cls.default_user_message
    assert msg  # non-empty
    # The user message must not leak the technical detail.
    assert "550e8400" not in msg


def test_custom_user_message_used() -> None:
    err = ValidationError("qty <= 0", user_message="Quantity must be greater than zero.")
    assert to_user_message(err) == "Quantity must be greater than zero."


def test_unexpected_error_maps_to_generic_message() -> None:
    msg = to_user_message(RuntimeError("boom at line 42\n  File ..."))
    assert msg == "An unexpected error occurred. Please try again."
    # No stack-trace fragments leak into the UI message.
    assert "File" not in msg
    assert "line 42" not in msg


def test_report_error_returns_message_and_logs(caplog: pytest.LogCaptureFixture) -> None:
    logger = logging.getLogger("test.ui.errors")
    with caplog.at_level(logging.ERROR, logger="test.ui.errors"):
        message = report_error(
            DatabaseError("disk I/O error on invoices.db"),
            context="save invoice",
            logger=logger,
        )
    assert message == DatabaseError.default_user_message
    # Technical detail is logged (not shown to the user).
    assert any("save invoice" in r.getMessage() for r in caplog.records)
    assert any("disk I/O error" in r.getMessage() for r in caplog.records)


def test_log_error_includes_traceback(caplog: pytest.LogCaptureFixture) -> None:
    logger = logging.getLogger("test.ui.errors2")
    try:
        raise PDFGenerationError("cannot open font")
    except PDFGenerationError as exc:
        with caplog.at_level(logging.ERROR, logger="test.ui.errors2"):
            log_error(exc, context="render", logger=logger)
    record = caplog.records[-1]
    assert record.exc_info is not None  # traceback captured for the log
    assert record.levelno == logging.ERROR


def test_application_error_has_user_message_attribute() -> None:
    err = ApplicationError("internal")
    assert err.user_message == ApplicationError.default_user_message


def test_no_stack_trace_in_any_user_message() -> None:
    # Even when the exception message contains newline/traceback-like text, the
    # user message stays a single clean sentence.
    err = BackupError("Traceback (most recent call last):\n  File 'x'")
    assert "Traceback" not in to_user_message(err)
