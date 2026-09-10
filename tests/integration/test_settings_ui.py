"""Tests for the settings controller and screen (Task 46)."""

from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

from invoice_generator.application.settings_service import SettingsService  # noqa: E402
from invoice_generator.domain.models import Company, TaxRateConfig  # noqa: E402
from invoice_generator.domain.numbering import NumberingConfig  # noqa: E402
from invoice_generator.infrastructure.assets.asset_store import AssetStore  # noqa: E402
from invoice_generator.ui.settings.settings_controller import SettingsController  # noqa: E402
from invoice_generator.ui.settings.settings_screen import SettingsScreen  # noqa: E402
from tests.support.fakes import (  # noqa: E402
    InMemoryAssetRepository,
    InMemoryCompanyRepository,
    InMemorySettingsRepository,
)
from tests.support.id_factory import SequentialIdGenerator  # noqa: E402

VALID_GSTIN = "27ABCDE1234F1Z5"


def _controller(tmp_path: Path) -> SettingsController:
    return SettingsController(
        InMemoryCompanyRepository(),
        InMemoryAssetRepository(),
        SettingsService(InMemorySettingsRepository()),
        AssetStore(tmp_path / "assets", id_generator=SequentialIdGenerator(start=1)),
    )


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    return QApplication.instance() or QApplication([])


# --- controller: company ---


def test_save_valid_company(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    company = Company(name="Suntech", gstin=VALID_GSTIN)
    result = ctrl.save_company(company)
    assert result.is_ok
    assert ctrl.load_company().name == "Suntech"


def test_invalid_gstin_blocks_company_save(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    result = ctrl.save_company(Company(name="Suntech", gstin="BADGSTIN"))
    assert not result.is_ok
    assert any(i.field == "company.gstin" for i in result.blocking)
    # Not persisted.
    assert ctrl.load_company().name == ""


# --- controller: numbering + tax ---


def test_numbering_config_persisted(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    config = NumberingConfig(prefix="ACME", pad_width=4, start_value=100)
    ctrl.save_numbering_config(config)
    assert ctrl.load_numbering_config() == config


def test_tax_config_persisted(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    config = TaxRateConfig(
        total_rate=Decimal("18"),
        cgst_rate=Decimal("9"),
        sgst_rate=Decimal("9"),
        igst_rate=Decimal("18"),
    )
    ctrl.save_tax_config(config)
    assert ctrl.load_tax_config() == config


def test_default_tax_config_when_unset(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    tax = ctrl.load_tax_config()
    assert tax.total_rate == Decimal("18")
    assert tax.cgst_rate == Decimal("9")


# --- controller: versioned assets ---


def test_import_logo_asset_is_versioned(tmp_path: Path) -> None:
    from PIL import Image as PILImage

    logo = tmp_path / "logo.png"
    PILImage.new("RGB", (100, 50), "white").save(logo)
    ctrl = _controller(tmp_path)
    asset = ctrl.import_asset(str(logo), kind="logo")
    assert asset is not None
    assert asset.kind == "logo"
    assert asset.version == 1
    assert asset.sha256  # content hash recorded
    assert Path(asset.stored_path).is_file()


def test_import_missing_asset_returns_none(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    assert ctrl.import_asset(str(tmp_path / "nope.png"), kind="logo") is None


def test_resolve_missing_asset_is_none(tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    assert ctrl.resolve_asset(None) is None


# --- widget (offscreen) ---


def test_screen_loads_and_saves(qapp: QApplication, tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    screen = SettingsScreen(ctrl)
    screen.name.setText("Suntech Enterprises")
    screen.gstin.setText(VALID_GSTIN)
    screen.state_code.setText("27")
    screen.prefix.setText("SE")
    result = screen.save()
    assert result.is_ok
    # Persisted through the controller.
    assert ctrl.load_company().name == "Suntech Enterprises"
    assert ctrl.load_numbering_config().prefix == "SE"


def test_screen_invalid_gstin_returns_blocking(qapp: QApplication, tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    screen = SettingsScreen(ctrl)
    screen.name.setText("Suntech")
    screen.gstin.setText("BAD")
    result = screen.save()
    assert not result.is_ok


def test_screen_set_logo_missing_file_returns_false(qapp: QApplication, tmp_path: Path) -> None:
    ctrl = _controller(tmp_path)
    screen = SettingsScreen(ctrl)
    assert screen.set_logo(str(tmp_path / "missing.png")) is False
