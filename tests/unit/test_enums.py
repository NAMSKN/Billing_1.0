"""Unit tests for domain enumerations."""

from __future__ import annotations

from invoice_generator.domain.enums import (
    InvoiceStatus,
    PaymentStatus,
    TaxTreatment,
    TaxType,
)


def test_invoice_status_members() -> None:
    assert {s.value for s in InvoiceStatus} == {"DRAFT", "FINALIZED", "CANCELLED"}


def test_payment_status_members() -> None:
    assert {s.value for s in PaymentStatus} == {"UNPAID", "PARTIAL", "PAID"}


def test_tax_type_members() -> None:
    assert {t.value for t in TaxType} == {"INTRA_STATE", "INTER_STATE"}


def test_tax_treatment_v1_supports_only_taxable() -> None:
    # V1 supports only TAXABLE (DECISIONS D-007/D-008). This test guards the
    # extension point: adding a new treatment is a deliberate change that must
    # bring its own calculation handling, not a silent 0% via TAXABLE.
    assert [t.value for t in TaxTreatment] == ["TAXABLE"]


def test_enums_serialize_to_stable_string_values() -> None:
    # Members are str enums so their .value is the persisted/serialized token.
    assert InvoiceStatus.DRAFT.value == "DRAFT"
    assert PaymentStatus.UNPAID.value == "UNPAID"
    assert TaxType.INTRA_STATE.value == "INTRA_STATE"
    assert TaxTreatment.TAXABLE.value == "TAXABLE"


def test_enum_round_trip_from_value() -> None:
    # Repositories/snapshots reconstruct enums from stored string values.
    assert InvoiceStatus("FINALIZED") is InvoiceStatus.FINALIZED
    assert PaymentStatus("PAID") is PaymentStatus.PAID
    assert TaxType("INTER_STATE") is TaxType.INTER_STATE
    assert TaxTreatment("TAXABLE") is TaxTreatment.TAXABLE


def test_lifecycle_and_payment_status_are_not_mixed() -> None:
    # The two concerns are distinct: no shared values, distinct enum types.
    lifecycle = {s.value for s in InvoiceStatus}
    payment = {s.value for s in PaymentStatus}
    assert lifecycle.isdisjoint(payment)
    assert InvoiceStatus is not PaymentStatus
