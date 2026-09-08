"""Unit tests for tax-type determination and treatment guard."""

from __future__ import annotations

import pytest

from invoice_generator.domain.calculation import (
    UnsupportedTaxTreatmentError,
    determine_tax_type,
    ensure_supported_treatment,
)
from invoice_generator.domain.enums import TaxTreatment, TaxType


def test_same_state_is_intra_state() -> None:
    assert determine_tax_type("27", "27") is TaxType.INTRA_STATE


def test_different_state_is_inter_state() -> None:
    assert determine_tax_type("27", "29") is TaxType.INTER_STATE


def test_state_codes_compared_after_trim() -> None:
    assert determine_tax_type(" 27 ", "27") is TaxType.INTRA_STATE
    assert determine_tax_type("27", " 29 ") is TaxType.INTER_STATE


def test_taxable_treatment_is_supported() -> None:
    # Should not raise.
    ensure_supported_treatment(TaxTreatment.TAXABLE)


def test_v1_has_only_taxable_treatment() -> None:
    # Guards the scope decision (D-008): only TAXABLE exists in V1.
    assert list(TaxTreatment) == [TaxTreatment.TAXABLE]


def test_unsupported_treatment_raises() -> None:
    # The guard rejects anything that is not the TAXABLE member. Since V1 has no
    # other enum member, use a stand-in that mimics a future/unsupported
    # treatment to exercise the failure branch (it must raise, not return 0%).
    class _UnsupportedTreatment:
        value = "REVERSE_CHARGE"

    with pytest.raises(UnsupportedTaxTreatmentError):
        ensure_supported_treatment(_UnsupportedTreatment())  # type: ignore[arg-type]
