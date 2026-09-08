"""Platform-aware local application data paths.

Resolves an OS-appropriate user data directory and the sub-directories the
application needs (database, exports, backups, assets, logs). User data is kept
separate from the install directory so upgrades never destroy invoices
(Requirements 17.1, 23.2).

All paths are built with :mod:`pathlib`. No Unix-specific paths are hardcoded
and no network calls are made.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

APP_DIR_NAME = "InvoiceGenerator"


def _windows_base_dir() -> Path:
    """Return the Windows per-user application data base directory."""
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data)
    # Fall back to the user profile if LOCALAPPDATA is unset.
    return Path.home() / "AppData" / "Local"


def _macos_base_dir() -> Path:
    """Return the macOS per-user application support base directory."""
    return Path.home() / "Library" / "Application Support"


def _xdg_base_dir() -> Path:
    """Return the Linux/other XDG data base directory."""
    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home)
    return Path.home() / ".local" / "share"


def _resolve_base_dir() -> Path:
    """Resolve the platform-appropriate user data base directory."""
    if sys.platform.startswith("win"):
        return _windows_base_dir()
    if sys.platform == "darwin":
        return _macos_base_dir()
    return _xdg_base_dir()


@dataclass(frozen=True)
class AppPaths:
    """Resolved application data paths.

    Immutable per the coding standards. ``root`` is the application's user
    data directory; the remaining paths are its standard sub-directories.
    """

    root: Path

    @property
    def database_dir(self) -> Path:
        return self.root / "database"

    @property
    def database_file(self) -> Path:
        return self.database_dir / "invoices.db"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports"

    @property
    def backups_dir(self) -> Path:
        return self.root / "backups"

    @property
    def assets_dir(self) -> Path:
        return self.root / "assets"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def log_file(self) -> Path:
        return self.logs_dir / "app.log"

    def all_dirs(self) -> tuple[Path, ...]:
        """Return every directory the application expects to exist."""
        return (
            self.root,
            self.database_dir,
            self.exports_dir,
            self.backups_dir,
            self.assets_dir,
            self.logs_dir,
        )

    def ensure_exists(self) -> None:
        """Create all application data directories if they do not exist."""
        for directory in self.all_dirs():
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_app_paths(override_root: Path | None = None) -> AppPaths:
    """Return the resolved :class:`AppPaths`.

    Args:
        override_root: Optional explicit root, primarily for tests. When
            omitted, the platform-appropriate user data directory is used.

    The result is cached so repeated calls return the same instance.
    """
    root = override_root if override_root is not None else _resolve_base_dir() / APP_DIR_NAME
    return AppPaths(root=root)
