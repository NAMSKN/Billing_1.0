"""Unit tests for platform-aware application data paths."""

from __future__ import annotations

import sys
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from invoice_generator.config.paths import (
    APP_DIR_NAME,
    AppPaths,
    _resolve_base_dir,
    get_app_paths,
)


def test_app_paths_subdirs_are_under_root(tmp_path: Path) -> None:
    paths = AppPaths(root=tmp_path)
    assert paths.database_dir == tmp_path / "database"
    assert paths.database_file == tmp_path / "database" / "invoices.db"
    assert paths.exports_dir == tmp_path / "exports"
    assert paths.backups_dir == tmp_path / "backups"
    assert paths.assets_dir == tmp_path / "assets"
    assert paths.logs_dir == tmp_path / "logs"
    assert paths.log_file == tmp_path / "logs" / "app.log"


def test_ensure_exists_creates_all_directories(tmp_path: Path) -> None:
    paths = AppPaths(root=tmp_path / "InvoiceGenerator")
    paths.ensure_exists()
    for directory in paths.all_dirs():
        assert directory.is_dir()


def test_ensure_exists_is_idempotent(tmp_path: Path) -> None:
    paths = AppPaths(root=tmp_path / "InvoiceGenerator")
    paths.ensure_exists()
    paths.ensure_exists()  # second call must not raise
    assert paths.root.is_dir()


def test_app_paths_is_immutable(tmp_path: Path) -> None:
    paths = AppPaths(root=tmp_path)
    with pytest.raises(FrozenInstanceError):
        paths.root = tmp_path / "other"  # type: ignore[misc]


def test_get_app_paths_override_root(tmp_path: Path) -> None:
    get_app_paths.cache_clear()
    try:
        paths = get_app_paths(override_root=tmp_path)
        assert paths.root == tmp_path
    finally:
        get_app_paths.cache_clear()


def test_resolve_base_dir_matches_platform(monkeypatch: pytest.MonkeyPatch) -> None:
    root = get_app_paths.__wrapped__().root  # type: ignore[attr-defined]
    assert root.name == APP_DIR_NAME
    # The resolved base directory is an absolute path on this platform.
    assert _resolve_base_dir().is_absolute()


@pytest.mark.skipif(not sys.platform.startswith("win"), reason="Windows-specific check")
def test_windows_base_uses_localappdata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\Test\AppData\Local")
    assert _resolve_base_dir() == Path(r"C:\Users\Test\AppData\Local")
