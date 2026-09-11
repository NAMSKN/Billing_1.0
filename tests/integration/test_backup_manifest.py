"""Tests for backup packaging and integrity manifest (Task 53).

Verifies a package is created with the DB snapshot, required asset files, and a
manifest (sizes + SHA-256), and that validation detects tampering/corruption.

References: requirements Req 15.2; DECISIONS D-018, D-019.
"""

from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path

from invoice_generator.domain.models import Address, Company
from invoice_generator.infrastructure.backup.manifest import (
    ASSETS_PREFIX,
    DATABASE_ENTRY,
    MANIFEST_NAME,
    BackupManifest,
    create_package,
    read_manifest,
    validate_package,
)
from tests.support.build_test_app import build_test_app

APP_VERSION = "0.1.0"
SCHEMA_VERSION = 1
CREATED_AT = "2026-05-11T09:00:00+00:00"


def _seed_db(tmp_path: Path) -> Path:
    app = build_test_app(tmp_path)
    try:
        app.company_service_repo.save(
            Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
        )
    finally:
        app.close()
    return tmp_path / "invoices.db"


def _make_asset(tmp_path: Path, name: str, content: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(content)
    return path


def _build(tmp_path: Path, *, assets: list[Path] | None = None) -> Path:
    source = _seed_db(tmp_path)
    dest = tmp_path / "backups" / "backup.zip"
    return create_package(
        source_db=source,
        asset_files=assets or [],
        schema_version=SCHEMA_VERSION,
        app_version=APP_VERSION,
        destination=dest,
        created_at=CREATED_AT,
    )


# --- creation / manifest content ---


def test_package_created_with_manifest_and_db(tmp_path: Path) -> None:
    pkg = _build(tmp_path)
    assert pkg.exists()
    with zipfile.ZipFile(pkg) as archive:
        names = set(archive.namelist())
    assert MANIFEST_NAME in names
    assert DATABASE_ENTRY in names


def test_manifest_records_version_and_hashes(tmp_path: Path) -> None:
    pkg = _build(tmp_path)
    manifest = read_manifest(pkg)
    assert manifest.schema_version == SCHEMA_VERSION
    assert manifest.app_version == APP_VERSION
    assert manifest.created_at == CREATED_AT
    db_entry = next(f for f in manifest.files if f.path == DATABASE_ENTRY)
    assert db_entry.size > 0
    assert len(db_entry.sha256) == 64  # SHA-256 hex


def test_assets_included(tmp_path: Path) -> None:
    logo = _make_asset(tmp_path, "logo.png", b"\x89PNG logo-bytes")
    sig = _make_asset(tmp_path, "signature.png", b"\x89PNG sig-bytes")
    pkg = _build(tmp_path, assets=[logo, sig])

    manifest = read_manifest(pkg)
    packaged = {f.path for f in manifest.files}
    assert f"{ASSETS_PREFIX}logo.png" in packaged
    assert f"{ASSETS_PREFIX}signature.png" in packaged

    logo_entry = next(f for f in manifest.files if f.path == f"{ASSETS_PREFIX}logo.png")
    assert logo_entry.sha256 == hashlib.sha256(b"\x89PNG logo-bytes").hexdigest()


def test_manifest_round_trip_json() -> None:
    manifest = BackupManifest.from_json(
        BackupManifest(
            manifest_version=1,
            schema_version=SCHEMA_VERSION,
            app_version=APP_VERSION,
            created_at=CREATED_AT,
            files=(),
        ).to_json()
    )
    assert manifest.app_version == APP_VERSION
    assert manifest.files == ()


# --- validation ---


def test_valid_package_passes(tmp_path: Path) -> None:
    logo = _make_asset(tmp_path, "logo.png", b"logo")
    pkg = _build(tmp_path, assets=[logo])
    result = validate_package(pkg)
    assert result.ok
    assert result.errors == ()


def _rewrite_zip(pkg: Path, mutate: dict[str, bytes], drop: set[str] | None = None) -> None:
    """Rewrite a zip package, replacing/adding entries in ``mutate``."""
    drop = drop or set()
    with zipfile.ZipFile(pkg) as archive:
        items = {n: archive.read(n) for n in archive.namelist()}
    items.update(mutate)
    for name in drop:
        items.pop(name, None)
    with zipfile.ZipFile(pkg, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in items.items():
            archive.writestr(name, data)


def test_tampered_database_detected(tmp_path: Path) -> None:
    pkg = _build(tmp_path)
    _rewrite_zip(pkg, {DATABASE_ENTRY: b"corrupted-bytes"})
    result = validate_package(pkg)
    assert not result.ok
    assert any(DATABASE_ENTRY in e for e in result.errors)


def test_tampered_asset_detected(tmp_path: Path) -> None:
    logo = _make_asset(tmp_path, "logo.png", b"original")
    pkg = _build(tmp_path, assets=[logo])
    _rewrite_zip(pkg, {f"{ASSETS_PREFIX}logo.png": b"swapped"})
    result = validate_package(pkg)
    assert not result.ok
    assert any("logo.png" in e for e in result.errors)


def test_missing_file_detected(tmp_path: Path) -> None:
    logo = _make_asset(tmp_path, "logo.png", b"original")
    pkg = _build(tmp_path, assets=[logo])
    _rewrite_zip(pkg, {}, drop={f"{ASSETS_PREFIX}logo.png"})
    result = validate_package(pkg)
    assert not result.ok
    assert any("missing file" in e for e in result.errors)


def test_unexpected_extra_file_detected(tmp_path: Path) -> None:
    pkg = _build(tmp_path)
    _rewrite_zip(pkg, {"stowaway.txt": b"unexpected"})
    result = validate_package(pkg)
    assert not result.ok
    assert any("unexpected file" in e for e in result.errors)


def test_missing_manifest_detected(tmp_path: Path) -> None:
    pkg = _build(tmp_path)
    _rewrite_zip(pkg, {}, drop={MANIFEST_NAME})
    result = validate_package(pkg)
    assert not result.ok
    assert any("manifest missing" in e for e in result.errors)


def test_not_a_zip_detected(tmp_path: Path) -> None:
    bogus = tmp_path / "backup.zip"
    bogus.write_bytes(b"this is not a zip archive")
    result = validate_package(bogus)
    assert not result.ok
    assert any("not a valid archive" in e for e in result.errors)


def test_missing_package_detected(tmp_path: Path) -> None:
    result = validate_package(tmp_path / "nope.zip")
    assert not result.ok
    assert any("not found" in e for e in result.errors)
