"""Shared base domain models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DomainModel(BaseModel):
    """Base for frozen domain models across all modules.

    ``frozen=True`` makes instances immutable and hashable. ``extra="forbid"``
    rejects unknown fields early.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")
