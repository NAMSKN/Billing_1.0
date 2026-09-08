"""Application configuration: platform-aware paths and logging setup."""

from invoice_generator.config.logging_setup import configure_logging, get_logger
from invoice_generator.config.paths import AppPaths, get_app_paths

__all__ = [
    "AppPaths",
    "get_app_paths",
    "configure_logging",
    "get_logger",
]
