"""Application entry point.

Resolves the local data directory and logging, wires the application via the
composition root (which also runs database migrations on first launch), then
opens the PySide6 main window and runs the Qt event loop. No network calls are
made.
"""

from __future__ import annotations

import sys

from invoice_generator.bootstrap import Application, build_application
from invoice_generator.config import configure_logging, get_app_paths


def build_app() -> Application:
    """Initialize data dirs + logging and return the wired application.

    Migrations are applied by the composition root, so first launch creates the
    database schema.
    """
    paths = get_app_paths()
    paths.ensure_exists()
    logger = configure_logging(paths)
    logger.info("Invoice Generator starting; data directory %s", paths.root)
    return build_application(paths.database_file)


def main(argv: list[str] | None = None) -> int:
    """Launch the desktop application and run the Qt event loop.

    Returns the process exit code from the event loop.
    """
    # Imported lazily so foundation utilities do not require PySide6 at import.
    from PySide6.QtWidgets import QApplication

    from invoice_generator.ui.main_window import MainWindow

    application = build_app()
    qt_app = QApplication.instance() or QApplication(argv if argv is not None else sys.argv)
    window = MainWindow(application)
    window.show()
    try:
        return int(qt_app.exec())
    finally:
        application.close()


if __name__ == "__main__":
    raise SystemExit(main())
