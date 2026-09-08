"""Application entry point.

Task 1 (project foundation) only wires up the local data directories and
logging. Application layers (domain, persistence, UI) are added in later tasks.
No network calls are made.
"""

from __future__ import annotations

from invoice_generator.config import configure_logging, get_app_paths


def main() -> int:
    """Initialize local data directories and logging, then return.

    Returns a process exit code. UI startup is intentionally not implemented
    yet (see later tasks).
    """
    paths = get_app_paths()
    paths.ensure_exists()

    logger = configure_logging(paths)
    logger.info("Invoice Generator foundation initialized at %s", paths.root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
