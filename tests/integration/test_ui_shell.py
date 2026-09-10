"""Headless smoke tests for the PySide6 application shell (Task 44).

Runs offscreen (no display needed). Verifies the main window constructs, hosts
the five navigation screens, switches between them, and that the background
worker helper delivers results/errors.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from pathlib import Path

import pytest

# Must be set before the first Qt import so Qt uses the offscreen platform.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QThreadPool  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.ui.common.worker import run_in_background  # noqa: E402
from invoice_generator.ui.main_window import SCREENS, MainWindow  # noqa: E402
from tests.support.build_test_app import build_test_app  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


def test_main_window_constructs(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        assert window.windowTitle() == "Invoice Generator"
        assert window.application is app
    finally:
        app.close()


def test_all_five_screens_present(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        assert SCREENS == (
            "Dashboard",
            "Customers",
            "Create / Edit Invoice",
            "Invoice History",
            "Settings",
        )
        # Starts on the first screen.
        assert window.current_screen_name() == "Dashboard"
    finally:
        app.close()


def test_navigation_switches_screen(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        window.go_to("Settings")
        assert window.current_screen_name() == "Settings"
        window.go_to("Customers")
        assert window.current_screen_name() == "Customers"
    finally:
        app.close()


def test_go_to_unknown_screen_raises(qapp: QApplication, tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        window = MainWindow(app)
        with pytest.raises(ValueError):
            window.go_to("Nonexistent")
    finally:
        app.close()


def _drain_until(qapp: QApplication, pool: QThreadPool, done: Callable[[], bool]) -> None:
    """Wait for the pool and pump the event loop until ``done`` or timeout."""
    pool.waitForDone(5000)
    deadline = time.monotonic() + 5.0
    while not done() and time.monotonic() < deadline:
        qapp.processEvents()
        time.sleep(0.01)
    qapp.processEvents()


def test_worker_runs_and_reports_result(qapp: QApplication) -> None:
    results: list[object] = []
    errors: list[BaseException] = []
    pool = QThreadPool()
    run_in_background(lambda: 6 * 7, results.append, errors.append, pool=pool)
    _drain_until(qapp, pool, lambda: bool(results or errors))
    assert results == [42]
    assert errors == []


def test_worker_reports_error(qapp: QApplication) -> None:
    results: list[object] = []
    errors: list[BaseException] = []

    def boom() -> None:
        raise ValueError("boom")

    pool = QThreadPool()
    run_in_background(boom, results.append, errors.append, pool=pool)
    _drain_until(qapp, pool, lambda: bool(results or errors))
    assert results == []
    assert len(errors) == 1
    assert isinstance(errors[0], ValueError)
