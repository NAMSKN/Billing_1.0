"""Unit tests for entity identity (UUID) helpers."""

from __future__ import annotations

import uuid

import pytest

from invoice_generator.domain.ids import (
    IdGenerator,
    Uuid4Generator,
    is_canonical,
    new_id,
    parse_uuid,
    to_canonical,
    validate_canonical,
)
from tests.support.id_factory import FixedIdGenerator, SequentialIdGenerator


def test_default_generator_produces_uuid4() -> None:
    generated = Uuid4Generator()()
    assert isinstance(generated, uuid.UUID)
    assert generated.version == 4


def test_new_id_defaults_to_uuid4() -> None:
    generated = new_id()
    assert isinstance(generated, uuid.UUID)
    assert generated.version == 4


def test_new_id_uses_injected_generator() -> None:
    gen = SequentialIdGenerator(start=1)
    first = new_id(gen)
    second = new_id(gen)
    assert to_canonical(first) == "00000000-0000-4000-8000-000000000001"
    assert to_canonical(second) == "00000000-0000-4000-8000-000000000002"
    assert first != second


def test_generators_satisfy_protocol() -> None:
    # runtime_checkable Protocol conformance for injected generators.
    assert isinstance(Uuid4Generator(), IdGenerator)
    assert isinstance(SequentialIdGenerator(), IdGenerator)
    assert isinstance(FixedIdGenerator(uuid.uuid4()), IdGenerator)


def test_fixed_generator_is_deterministic() -> None:
    value = uuid.UUID("11111111-1111-4111-8111-111111111111")
    gen = FixedIdGenerator(value)
    assert gen() == value
    assert gen() == value


def test_to_canonical_from_uuid() -> None:
    value = uuid.UUID("550e8400-e29b-41d4-a716-446655440000")
    assert to_canonical(value) == "550e8400-e29b-41d4-a716-446655440000"


def test_to_canonical_normalizes_noncanonical_strings() -> None:
    upper = "550E8400-E29B-41D4-A716-446655440000"
    braced = "{550e8400-e29b-41d4-a716-446655440000}"
    urn = "urn:uuid:550e8400-e29b-41d4-a716-446655440000"
    expected = "550e8400-e29b-41d4-a716-446655440000"
    assert to_canonical(upper) == expected
    assert to_canonical(braced) == expected
    assert to_canonical(urn) == expected


def test_is_canonical_accepts_canonical() -> None:
    assert is_canonical("550e8400-e29b-41d4-a716-446655440000") is True


@pytest.mark.parametrize(
    "value",
    [
        "550E8400-E29B-41D4-A716-446655440000",  # uppercase
        "{550e8400-e29b-41d4-a716-446655440000}",  # braces
        "urn:uuid:550e8400-e29b-41d4-a716-446655440000",  # urn prefix
        "550e8400e29b41d4a716446655440000",  # no hyphens
        "not-a-uuid",
        "",
    ],
)
def test_is_canonical_rejects_noncanonical(value: str) -> None:
    assert is_canonical(value) is False


def test_validate_canonical_returns_value_when_valid() -> None:
    value = "550e8400-e29b-41d4-a716-446655440000"
    assert validate_canonical(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "550E8400-E29B-41D4-A716-446655440000",
        "{550e8400-e29b-41d4-a716-446655440000}",
        "not-a-uuid",
    ],
)
def test_validate_canonical_raises_on_noncanonical(value: str) -> None:
    with pytest.raises(ValueError):
        validate_canonical(value)


def test_parse_uuid_round_trip() -> None:
    canonical = "550e8400-e29b-41d4-a716-446655440000"
    parsed = parse_uuid(canonical)
    assert isinstance(parsed, uuid.UUID)
    assert to_canonical(parsed) == canonical


def test_parse_uuid_rejects_noncanonical() -> None:
    with pytest.raises(ValueError):
        parse_uuid("550E8400-E29B-41D4-A716-446655440000")
