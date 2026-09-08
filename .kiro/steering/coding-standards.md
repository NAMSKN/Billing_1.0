# Coding Standards

Persistent code-quality constraints for the Python application.

## Style and typing

- Use type hints on all public functions, methods, and dataclass/model fields. Code passes `mypy` (strict) and `Ruff`.
- Follow standard Python style; keep line length within the configured Ruff limit.
- Use `pathlib` for filesystem paths. Never hardcode Unix- or Windows-only path strings; resolve platform-appropriate paths through the paths module.
- Prefer clear names over abbreviations. Name business concepts as the domain names them (invoice, line item, HSN/SAC, place of supply).

## Identifiers

- Use UUID4 for all persistent domain entity ids, generated in the application/domain layer (never SQLite AUTOINCREMENT). Ids are immutable, not user-editable, and never reused (DECISIONS D-023).
- Persist and compare UUIDs as canonical lowercase hyphenated TEXT; validate format at the repository boundary (DECISIONS D-024).
- Do not display UUIDs in normal UI (diagnostics only); logs may include them.
- Keep the invoice UUID and the invoice number distinct; never treat one as the other (DECISIONS D-025).
- For deterministic tests, inject an id generator or use a test UUID factory; do not monkeypatch the uuid module across the codebase (DECISIONS D-023).

## Money and numerics

- Use `Decimal` for all monetary values. Never use `float` for money.
- Persist money as integer paise; quantity/rate/discount%/tax% use the fixed scales defined in DECISIONS D-004/D-005. Convert only at the repository boundary.
- All rounding uses the calculation engine's defined `ROUND_HALF_UP` points. Do not round ad hoc elsewhere.

## Structure and purity

- Keep functions small and deterministic. Prefer pure functions for calculations (no I/O, no clock, no randomness).
- Prefer immutable data for finalized/domain values (frozen dataclasses or immutable models).
- No global mutable state. No service locator. Dependencies are injected.
- Avoid duplicated business logic; there is one calculation engine and one numbering service.

## Boundaries

- No SQL in UI classes. No GST/financial calculations in UI classes.
- The PDF renderer receives a prepared DTO; it does not access the DB or recalculate.
- Use parameterized SQL only; never build SQL by string concatenation of user input.

## Errors and logging

- Raise typed domain/application errors; translate to user-friendly messages at the UI boundary. Never surface raw stack traces in normal UI.
- Log locally only. Never log passwords, credentials, or unnecessary personal data.

## Change discipline

- Do not silently change product requirements or decisions. If a change is needed, update DECISIONS.md / OPEN_QUESTIONS.md and the affected spec.
- Do not implement unrelated features or add dependencies without a confirmed requirement.
- Preserve existing passing tests when modifying code; do not suppress type/lint errors without a written justification.
