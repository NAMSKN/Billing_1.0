"""Unit tests for local logging setup."""

from __future__ import annotations

import logging
from pathlib import Path

from invoice_generator.config.logging_setup import (
    LOGGER_NAME,
    configure_logging,
    get_logger,
)
from invoice_generator.config.paths import AppPaths


def _make_paths(tmp_path: Path) -> AppPaths:
    return AppPaths(root=tmp_path / "InvoiceGenerator")


def test_configure_logging_creates_log_file_on_write(tmp_path: Path) -> None:
    paths = _make_paths(tmp_path)
    logger = configure_logging(paths)
    logger.info("foundation test message")
    for handler in logger.handlers:
        handler.flush()
    assert paths.log_file.exists()
    assert "foundation test message" in paths.log_file.read_text(encoding="utf-8")


def test_configure_logging_does_not_duplicate_handlers(tmp_path: Path) -> None:
    paths = _make_paths(tmp_path)
    logger = configure_logging(paths)
    handler_count = len(logger.handlers)
    configure_logging(paths)
    assert len(logger.handlers) == handler_count


def test_logger_does_not_propagate(tmp_path: Path) -> None:
    paths = _make_paths(tmp_path)
    logger = configure_logging(paths)
    assert logger.propagate is False


def test_get_logger_returns_application_logger() -> None:
    assert get_logger().name == LOGGER_NAME


def test_get_logger_named_child() -> None:
    child = get_logger("paths")
    assert child.name == f"{LOGGER_NAME}.paths"
    assert isinstance(child, logging.Logger)
