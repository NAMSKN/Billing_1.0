"""Local application logging setup.

Configures standard Python logging to write to a local ``logs/app.log`` file
using a rotating file handler (Requirement 20.5). Logging is entirely local:
no network handlers are configured. Callers are responsible for not passing
passwords, credentials, or unnecessary personal data into log messages.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from invoice_generator.config.paths import AppPaths, get_app_paths

LOGGER_NAME = "invoice_generator"
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_MAX_BYTES = 1_000_000
_BACKUP_COUNT = 3


def configure_logging(
    paths: AppPaths | None = None,
    level: int = logging.INFO,
) -> logging.Logger:
    """Configure and return the application logger.

    Ensures the log directory exists, attaches a single rotating file handler
    to the application logger, and returns it. Calling this more than once does
    not attach duplicate handlers.

    Args:
        paths: Application paths providing the log file location. Resolved from
            the platform default when omitted.
        level: Logging level for the application logger.
    """
    resolved = paths if paths is not None else get_app_paths()
    log_file: Path = resolved.log_file
    log_file.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level)
    logger.propagate = False

    if not _has_file_handler(logger, log_file):
        handler = RotatingFileHandler(
            log_file,
            maxBytes=_MAX_BYTES,
            backupCount=_BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter(_LOG_FORMAT))
        logger.addHandler(handler)

    return logger


def _has_file_handler(logger: logging.Logger, log_file: Path) -> bool:
    """Return True if a handler for ``log_file`` is already attached."""
    target = str(log_file)
    for handler in logger.handlers:
        if isinstance(handler, RotatingFileHandler) and handler.baseFilename == target:
            return True
    return False


def get_logger(name: str | None = None) -> logging.Logger:
    """Return the application logger or a named child of it."""
    if name:
        return logging.getLogger(LOGGER_NAME).getChild(name)
    return logging.getLogger(LOGGER_NAME)
