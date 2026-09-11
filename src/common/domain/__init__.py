"""Shared domain primitives and base contracts."""

from common.domain.address import Address
from common.domain.base import DomainModel
from common.domain.clock import Clock, FrozenClock, SystemClock
from common.domain.ids import IdGenerator, Uuid4Generator, validate_canonical

__all__ = [
    "Address",
    "Clock",
    "DomainModel",
    "FrozenClock",
    "IdGenerator",
    "SystemClock",
    "Uuid4Generator",
    "validate_canonical",
]
