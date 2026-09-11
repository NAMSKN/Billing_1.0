"""Platform-aware application data paths."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

APP_DIR_NAME = "InvoiceGenerator"


def _windows_base_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data)
    return Path.home() / "AppData" / "Local"


def _macos_base_dir() -> Path:
    return Path.home() / "Library" / "Application Support"


def _xdg_base_dir() -> Path:
    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home)
    return Path.home() / ".local" / "share"


def get_base_data_dir() -> Path:
    if sys.platform == "win32":
        return _windows_base_dir()
    if sys.platform == "darwin":
        return _macos_base_dir()
    return _xdg_base_dir()


@dataclass(frozen=True)
class DataPaths:
    root: Path
    database: Path
    exports: Path
    backups: Path
    assets: Path
    logs: Path


@lru_cache(maxsize=1)
def resolve_data_paths(base_override: Path | None = None) -> DataPaths:
    root = (base_override or get_base_data_dir()) / APP_DIR_NAME
    return DataPaths(
        root=root,
        database=root / "database",
        exports=root / "exports",
        backups=root / "backups",
        assets=root / "assets",
        logs=root / "logs",
    )


def ensure_data_directories(paths: DataPaths) -> None:
    for directory in (paths.root, paths.database, paths.exports, paths.backups, paths.assets, paths.logs):
        directory.mkdir(parents=True, exist_ok=True)
