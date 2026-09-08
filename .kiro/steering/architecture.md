# Architecture Rules

Persistent architecture constraints. Kiro is the development environment, not the application runtime — never describe a Kiro runtime, framework, or widgets.

## Allowed runtime technologies

- Language: Python (>=3.11).
- Desktop UI: PySide6.
- Persistence: SQLite (embedded, local).
- PDF: ReportLab.
- Money: Python `Decimal` in the domain; exact integer paise in SQLite (DECISIONS D-004).
- Validation/modeling: Pydantic where it adds value; plain dataclasses where cleaner.
- Supporting local libs: qrcode, Pillow, num2words.
- Tooling: pytest, Ruff, mypy; packaging via PyInstaller (Windows-first).

## Forbidden

- No REST API, backend server, FastAPI, WebSockets/SSE/MQTT, Redis, Kafka, PostgreSQL, cloud infrastructure, React/browser UI, mobile framework, or online payment gateway.
- No runtime network calls anywhere.

## Layers and dependency direction

```
Presentation (PySide6)  →  Application services  →  Domain (rules, pure calc)  →  Repository ports
                                                                                     ↑
                                              Infrastructure (SQLite, ReportLab, printing, backup, fs)
```

- Dependencies point inward. Domain depends on nothing outside itself. UI and infrastructure depend on the domain, not vice versa.
- Services depend on repository interfaces (ports), not concrete SQLite classes.

## Hard boundaries

- UI must not execute SQL and must not implement business calculations.
- Exactly one calculation engine owns tax, discount, totals, and round-off (DECISIONS D-006). No other layer recalculates money.
- The PDF renderer must not query the database, resolve asset IDs, load mutable company settings, or recalculate anything. The PDF service resolves pinned asset IDs and builds the immutable render DTO first. Flow: finalized snapshot → PDF service resolves pinned assets → immutable render DTO → ReportLab renderer → PDF (DECISIONS D-011, D-031-boundary).
- For a finalized invoice, the stored snapshot is the authoritative source for document reproduction; structured columns exist only for search/listing/reporting. Reproduction never reads live Company/Customer master tables.
- Reprint/re-export must reproduce identical invoice content, not byte-for-byte identical PDF files (DECISIONS D-031).
- Persistence is reached only through repositories.

## Identity

- Every persistent domain entity uses an application-generated UUID4 as its internal id, stored as canonical lowercase TEXT in SQLite. No `AUTOINCREMENT`/INTEGER primary keys for domain entities (DECISIONS D-023, D-024).
- The invoice UUID (internal identity) is distinct from the invoice number (human-readable business number). Never call a UUID an "invoice number" (DECISIONS D-025).

## Transactions and integrity

- Application use cases own transaction boundaries. Repositories and the numbering service participate in the caller's transaction and MUST NOT begin or commit their own transaction when called within a use-case transaction (DECISIONS D-026).
- Finalization is one outer transaction: validate → resolve PoS → determine tax → calculate → allocate number → snapshot → pin asset/template → persist invoice/items/snapshot/sequence → commit; any failure rolls back completely.
- A business invoice number is issued only when the finalization transaction commits; a rolled-back allocation is not issued and may be reused by a later successful transaction. A committed number is never reused, even after cancellation (DECISIONS D-027).
- Sequence locking uses SQLite semantics: open the transaction with `BEGIN IMMEDIATE`, then read/update the sequence row. Do not use `SELECT ... FOR UPDATE`. The `UNIQUE` constraint on invoice_number is the final backstop (DECISIONS D-028).
- Invoice numbering uses a dedicated sequence with a persisted high-water mark. Restore reconciliation uses the pre-restore trusted numbering state captured from the current DB (not the older backup's internal mark), reconciling each numbering scope independently before new numbers are issued (DECISIONS D-029; supersedes the earlier reading of D-018).
- Backups use SQLite's safe backup mechanism, never a raw file copy during writes (DECISIONS D-018).

## Composition and simplicity

- Wire dependencies in one small composition root using constructor injection (DECISIONS D-021). No service locator, no global mutable container/state.
- Keep modules small and focused. Avoid unnecessary abstractions, generic repository frameworks, plugin systems, premature async, and background workers without a confirmed need.
- Isolate platform-specific code (paths, printing) behind thin adapters.
