"""Unit tests for numbering configuration, FY derivation, and formatting."""

from __future__ import annotations

from datetime import date

import pytest

from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.numbering import (
    FinancialYear,
    NumberingConfig,
    build_invoice_number,
    financial_year_for,
    format_financial_year,
    format_invoice_number,
)
from tests.support.fakes import InMemorySettingsRepository


def test_default_config_matches_safe_interims() -> None:
    config = NumberingConfig()
    assert config.prefix == "SE"
    assert config.pad_width == 3
    assert config.start_value == 1
    assert config.fy_scheme == "IN"


def test_format_invoice_number_prefix_fy_nnn() -> None:
    config = NumberingConfig(prefix="SE", pad_width=3)
    assert format_invoice_number(config, "26-27", 43) == "SE/26-27/043"


def test_configurable_pad_width() -> None:
    assert format_invoice_number(NumberingConfig(pad_width=5), "26-27", 43) == "SE/26-27/00043"
    assert format_invoice_number(NumberingConfig(pad_width=1), "26-27", 43) == "SE/26-27/43"


def test_sequence_wider_than_pad_is_not_truncated() -> None:
    assert format_invoice_number(NumberingConfig(pad_width=3), "26-27", 1234) == "SE/26-27/1234"


def test_configurable_prefix() -> None:
    assert format_invoice_number(NumberingConfig(prefix="ACME"), "26-27", 1) == "ACME/26-27/001"


def test_fy_for_date_in_first_half() -> None:
    # April..December -> (year, year+1)
    assert financial_year_for(date(2026, 5, 11)) == FinancialYear(2026, 2027)
    assert financial_year_for(date(2026, 12, 31)) == FinancialYear(2026, 2027)


def test_fy_for_date_in_second_half() -> None:
    # January..March -> (year-1, year)
    assert financial_year_for(date(2027, 3, 31)) == FinancialYear(2026, 2027)
    assert financial_year_for(date(2027, 1, 1)) == FinancialYear(2026, 2027)


def test_fy_boundary_april_first() -> None:
    assert financial_year_for(date(2026, 4, 1)) == FinancialYear(2026, 2027)
    assert financial_year_for(date(2026, 3, 31)) == FinancialYear(2025, 2026)


def test_format_financial_year_yy_yy() -> None:
    assert format_financial_year(FinancialYear(2026, 2027)) == "26-27"
    assert format_financial_year(FinancialYear(1999, 2000)) == "99-00"


def test_build_invoice_number_from_date() -> None:
    config = NumberingConfig(prefix="SE", pad_width=3)
    assert build_invoice_number(config, date(2026, 5, 11), 43) == "SE/26-27/043"


def test_unsupported_fy_scheme_raises() -> None:
    with pytest.raises(ValueError):
        financial_year_for(date(2026, 5, 11), scheme="US")


# --- SettingsService ---


def test_settings_service_returns_default_when_unset() -> None:
    service = SettingsService(InMemorySettingsRepository())
    assert service.get_numbering_config() == NumberingConfig()


def test_settings_service_round_trip() -> None:
    service = SettingsService(InMemorySettingsRepository())
    config = NumberingConfig(prefix="ACME", pad_width=4, start_value=100, fy_scheme="IN")
    service.save_numbering_config(config)
    assert service.get_numbering_config() == config
