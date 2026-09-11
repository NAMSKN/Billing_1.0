# DECISIONS

## Architectural and Product Decision Record — Invoice Generator

**Status:** Baseline decisions for Version 1
**Scope:** Local Windows-first desktop billing application for a mould / mould-machining business
**How to read:** Each decision is intentional and authoritative. It records the decision, why it was made, and its consequences. Decisions here override lower-level spec documents; genuinely unresolved items live in `OPEN_QUESTIONS.md` and must not be guessed.

---

### D-001: Desktop-only, Windows-first for Version 1

- **Decision:** Version 1 is a single-computer desktop application targeting Windows first. macOS/Linux are not release targets for V1 but the code avoids Windows-only assumptions outside a small platform boundary (paths, printing).
- **Rationale:** The user is a small-business billing operator on one PC. A desktop app removes cloud cost, hosting, and connectivity risk. Windows is the confirmed deployment environment.
- **Consequences:** Packaging targets a Windows executable (D-013). Printing/preview must be proven on Windows early (see tasks Phase 5). Cross-platform path/printer code is isolated behind adapters so a later port stays feasible.

### D-002: Runtime stack is Python + PySide6 + SQLite + ReportLab

- **Decision:** Application language is Python. UI is PySide6. Local persistence is SQLite. PDF generation is ReportLab. Supporting local libraries: qrcode (UPI QR), Pillow (images), num2words (amount in words). Testing with pytest; quality with Ruff and mypy.
- **Rationale:** Mature, offline-capable, deterministic desktop stack. ReportLab gives programmatic, reproducible A4 layout. SQLite is embedded, transactional, and needs no server.
- **Consequences:** No web/server/cloud stack (D-014). Kiro is the development environment only, never the runtime. Dependencies are pinned with lower bounds in `pyproject.toml` and must not require internet at runtime.

### D-003: Kiro is the development environment, not the runtime

- **Decision:** Kiro (Specs, Steering, Hooks) is used to design, build, and review the application. It is not an application framework, UI toolkit, or runtime.
- **Rationale:** Prevents accidentally coupling the shipped product to the authoring tool.
- **Consequences:** Specs must never describe a "Kiro runtime," Kiro widgets, or Kiro services as part of the application.

### D-004: Decimal in Python, integer minor units (paise) in SQLite

- **Decision:** All monetary values use Python `Decimal` in the domain/calculation layer. Money is persisted losslessly in SQLite as **integer paise** (INTEGER columns), not REAL and not text-formatted currency. Conversion happens at the repository boundary only.
- **Rationale:** Binary floating point is unsafe for money. SQLite `REAL` is IEEE-754 and would lose precision. Integer paise is exact, sortable, and simple to sum.
- **Consequences:** A dedicated `Money` representation and (paise ⇄ Decimal) conversion helpers are required. Every monetary column is INTEGER paise. Serialization rules for quantity, rate, discount %, and tax % are defined separately (D-005).

### D-005: Explicit precision for non-money numerics

- **Decision:** Quantity, rate, discount percent, and tax percent have explicit precision and lossless storage:
  - Rate is money-per-unit → stored as integer paise (same as money).
  - Quantity → stored as an exact scaled integer with a fixed scale of 3 decimal places (millis), covering fractional units (e.g. MM, KG, HOURS).
  - Discount percent and tax percent → stored as exact scaled integers with a fixed scale of 2 decimal places (basis-of-hundredths), e.g. 18.00% stored as 1800.
- **Rationale:** Avoids float drift across UI → domain → DB → calculation → PDF. Fixed scales keep arithmetic exact and reproducible.
- **Consequences:** Domain uses `Decimal`; repositories convert to/from the scaled integers. Calculation order and quantization points are defined once in the calculation engine (D-006).

### D-006: One authoritative calculation engine

- **Decision:** A single `CalculationService` owns line amount, discount, taxable amount, tax determination, tax amounts, tax grouping, totals, and round-off. Quantization to 2 dp uses `ROUND_HALF_UP` at defined points. No other layer recalculates money.
- **Rationale:** Guarantees the UI, persistence, and PDF all show identical values; makes calculations unit-testable in isolation.
- **Consequences:** UI and PDF consume calculated results only (D-010, D-011). The golden invoices (043, 089) are regression fixtures against this engine.

### D-007: GST scope for V1 — normal taxable supply only

- **Decision:** V1 supports normal taxable supply, intra-state (CGST + SGST) and inter-state (IGST), with configurable rates and an explicit Place of Supply. A single normal supply line never carries CGST/SGST and IGST simultaneously.
- **Rationale:** Matches the source invoices and the confirmed business need without over-building.
- **Consequences:** Reverse charge, exempt, nil-rated, zero-rated, export, and SEZ treatments are **explicitly out of scope for V1** (see D-008). They must not be silently modeled as generic 0%.

### D-008: Special GST treatments are out of scope for V1

- **Decision:** Reverse charge, exempt, nil-rated, zero-rated, export, and SEZ supplies are not supported in V1 and must not be approximated as 0% tax.
- **Rationale:** Each has distinct legal/reporting semantics; approximating them produces incorrect invoices. There is no confirmed V1 need.
- **Consequences:** The domain models a `TaxTreatment` enum with only `TAXABLE` for V1, leaving room to extend later. Attempting an unsupported treatment is a validation error, not a silent 0%.

### D-009: Place of Supply is an explicit, authoritative tax input

- **Decision:** Place of Supply (a state + state code) is an explicit field on the invoice and is the authoritative input to intra/inter-state determination, defaulting from the customer but overridable.
- **Rationale:** Tax type must not be an accidental inference buried in UI logic.
- **Consequences:** The calculation engine derives tax type from company state vs Place of Supply. UI only collects the value; it does not decide tax type.

### D-010: Finalized invoices are immutable historical records

- **Decision:** On finalization, an invoice stores a complete invoice-facing snapshot (company, customer, addresses, GSTIN/state, references, line items, job/mould data, HSN/SAC, quantity, unit, rate, discount, tax rates/amounts, totals, payment terms, due date, notes, terms, declaration, bank/UPI display info). Finalized number, dates, parties, and financials cannot be edited.
- **Rationale:** A tax invoice is a stable legal record; editing masters later must never alter history.
- **Consequences:** Snapshots are stored alongside foreign keys (D-002). Corrections use cancellation + new invoice (D-016). Reproduction reads only the snapshot, never live masters.

### D-011: PDF renderer never queries the database

- **Decision:** The flow is: stored invoice → application/service layer builds an immutable render DTO/view model → ReportLab renderer → PDF. The renderer performs no DB access and no accounting recalculation.
- **Rationale:** One calculation source of truth (D-006); prevents UI/PDF divergence; keeps rendering unit-testable.
- **Consequences:** A render DTO type is required. Everything needed to draw the page (including formatted strings and asset references) is prepared before rendering.

### D-012: Dedicated invoice numbering sequence (never MAX())

- **Decision:** Invoice numbers are allocated from a dedicated numbering table scoped by (numbering scope, financial year, prefix) with a persisted `next_sequence` and a `high_water_mark`. Allocation is transactional. `MAX(invoice_number)` is never used.
- **Rationale:** String-parsing MAX is fragile and race-prone; a sequence is correct and supports restore reconciliation (D-018).
- **Consequences:** Numbering config, FY rollover, prefix changes, retries, and failure behavior are specified. Finalized numbers are never reused; cancellation does not release a number (D-016).

### D-013: Windows desktop packaging with user-data separation

- **Decision:** Ship as a Windows executable (PyInstaller or equivalent). User data (database, backups, exports, assets, logs) lives in the per-user application data directory, separate from the install directory.
- **Rationale:** Upgrades must never destroy invoices; installers replace program files, not data.
- **Consequences:** Platform-aware paths (already implemented in `config/paths.py`). Backups include data + manifest + required assets (D-017).

### D-014: No cloud, server, web, or online dependency

- **Decision:** No REST API, backend server, remote database, message queue, browser UI, mobile app, online payments, or live GSTIN verification. All core workflows run fully offline.
- **Rationale:** Product scope is a local billing tool; connectivity must never block billing.
- **Consequences:** GSTIN validation is format-only. No runtime network calls anywhere. This is enforced by steering and an offline verification task.

### D-015: Payment status is separate from invoice lifecycle; no accounting ledger in V1

- **Decision:** Invoice lifecycle (`DRAFT`, `FINALIZED`, `CANCELLED`) is independent from payment status (`UNPAID`, `PARTIAL`, `PAID`). Payment status is a display/local marker only. V1 does **not** implement a receipt/payment ledger or authoritative outstanding balances.
- **Rationale:** The product is a billing tool, not accounting software. Claiming authoritative balances without a ledger would be misleading.
- **Consequences:** Changing payment status never alters financial calculations or the invoice number. `PARTIAL` records the state but not a tracked paid amount unless a ledger is added later (tracked in OPEN_QUESTIONS).

### D-016: Cancellation preserves the record and its number

- **Decision:** Cancelling a finalized invoice sets status `CANCELLED`, records a cancellation timestamp and reason, retains all snapshot data, and never releases or reuses the invoice number. Cancelled invoices are never hard-deleted.
- **Rationale:** Audit/history integrity; a tax number, once issued, is permanent.
- **Consequences:** History and reprints show the cancelled state. An optional replacement-invoice relationship may be recorded (whether cancelled PDFs get a watermark is an OPEN_QUESTION).

### D-017: Duplication creates a new draft only

- **Decision:** Duplicating an invoice copies editable business content into a new `DRAFT`. It does not copy the original invoice id, finalized state, final invoice number, or payment status. The duplicate receives a new identity/number through the normal process at finalization.
- **Rationale:** Speeds repeated jobs without corrupting numbering or history.
- **Consequences:** Duplication is a domain operation in the invoice service, distinct from reprint.

### D-018: Safe backup/restore with numbering reconciliation

- **Decision:** Backups use SQLite's online backup API (or an equivalent consistent-snapshot mechanism), never a raw file copy during writes. A backup is a package containing the database, schema/app version, required assets, and a manifest with integrity info. Restore validates the backup, takes a safety backup of current data, restores atomically, and then reconciles invoice numbering against a persisted high-water mark before any new number is issued.
- **Rationale:** Prevents corrupt backups and, critically, prevents reissuing invoice numbers that existed after an older backup (a serious integrity risk).
- **Consequences:** The numbering table stores a monotonic `high_water_mark`. Reconciliation after restore is driven by the **pre-restore trusted state captured from the current database**, not by the older backup's internal high-water mark — see **D-029**, which supersedes this point. The system blocks new issuance until reconciled/confirmed (UX tracked in OPEN_QUESTIONS).

### D-019: Asset versioning for logo/signature/stamp

- **Decision:** Invoice assets (logo, signature, stamp) are content-addressed/versioned rather than mutable path references. A finalized invoice records the exact asset version it used; backups include those asset versions.
- **Rationale:** A mutable path makes historical PDFs change when a user replaces their logo. History must reproduce exactly.
- **Consequences:** An asset store keyed by version/hash is required. Live settings point to the current version; finalized invoices pin their version.

### D-020: Invoice template (layout) versioning

- **Decision:** A finalized invoice carries an invoice template/layout version separate from its content snapshot. Reprinting uses the stored content snapshot; the template version records which layout produced the original. Whether reprints re-render with a newer template or preserve the original template is a policy tracked in OPEN_QUESTIONS; the default is to preserve the stored template version.
- **Rationale:** Visual redesigns must not silently redefine or reflow historical invoices in a misleading way.
- **Consequences:** Template version is persisted on the invoice. The renderer selects layout by template version.

### D-021: Repository interfaces with SQLite implementations; DI via a small composition root

- **Decision:** Persistence is abstracted behind repository interfaces (ports) in the domain layer, implemented for SQLite in infrastructure. Dependencies are wired in a single small composition root using constructor injection. No service locator, no global mutable container.
- **Rationale:** Keeps business logic testable without SQL/UI; avoids god objects and hidden global state.
- **Consequences:** Services receive their dependencies explicitly. The composition root is introduced early (Phase 7) so services/renderer can be wired and tested coherently.

### D-022: Evidence-based task completion (Definition of Ready / Done)

- **Decision:** A task is Done only when implementation, tests, and lint/type checks pass and acceptance evidence exists. A checkbox alone is not evidence. Every task declares dependencies and acceptance evidence.
- **Rationale:** Prevents "looks implemented" from being mistaken for "works and is verified."
- **Consequences:** `tasks.md` defines global Definition of Ready and Definition of Done and per-task acceptance evidence.

### D-023: UUID4 entity identifiers

- **Decision:** Every persistent domain entity (Company, Customer, Invoice, InvoiceLine, Asset, ServiceTemplate, and any future entity) uses a UUID4 as its internal identity. IDs are generated by the application/domain layer, not by SQLite AUTOINCREMENT. IDs are immutable, not user-editable, and never reused even after deletion. Foreign keys reference UUID entity IDs.
- **Rationale:** Application-generated UUIDs decouple identity from storage, avoid dependence on insert order, make merges/backups/restores robust, and remove reliance on `AUTOINCREMENT` sequences.
- **Consequences:** No INTEGER surrogate primary keys for domain entities. An injectable ID generator (default UUID4) is provided so tests can be deterministic without monkeypatching. UUIDs are internal — the UI shows them only for diagnostics; logs may include them.

### D-024: UUIDs stored as canonical TEXT in SQLite

- **Decision:** UUIDs are persisted as TEXT in canonical lowercase hyphenated form (e.g. `550e8400-e29b-41d4-a716-446655440000`). Primary-key and required foreign-key UUID columns are `TEXT NOT NULL`. Serialization is consistent across all tables; format is validated at the repository/domain boundary. Binary and text UUID storage are never mixed.
- **Rationale:** One simple, greppable, debuggable representation for V1. A later binary optimization remains possible but is not needed now.
- **Consequences:** Repositories convert `uuid.UUID` ⇄ canonical string at the boundary. A format validator rejects non-canonical values.

### D-025: Invoice UUID is distinct from the invoice number

- **Decision:** The invoice **UUID** (internal identity, generated when the draft is created) is separate from the human-readable **invoice number** (e.g. `SE/26-27/043`, assigned only at finalization by the numbering rules). The UUID never replaces or is called an "invoice number." A draft has a UUID and a NULL invoice number. A cancelled invoice keeps the same UUID and same number. A duplicate gets a new UUID, no copied number, status DRAFT.
- **Rationale:** Prevents conflating an internal key with a legal business number.
- **Consequences:** `invoices.id` (UUID TEXT) and `invoices.invoice_number` (nullable business string) are distinct columns. Specs must not use "invoice number" to mean the UUID.

### D-026: Application use cases own transaction boundaries

- **Decision:** The finalization use case (`InvoiceService.finalize`) owns the single transaction. Repositories and the numbering service **participate** in the caller's transaction and MUST NOT begin or commit their own transaction when invoked within a use-case transaction. A simple UnitOfWork/transaction-context may be used; no generic transaction framework.
- **Rationale:** A single outer transaction is required for atomic finalization; inner commits would break atomicity and could leak partial state.
- **Consequences:** The numbering allocation runs inside the finalization transaction. Repositories expose methods that accept/participate in the active connection/transaction rather than opening their own.

### D-027: A number is issued only on successful commit

- **Decision:** A business invoice number is considered **issued** only when the finalization transaction commits successfully. If the transaction rolls back, the number was not issued and may be allocated by a later successful transaction. Once committed, the number is permanent and is never reused — including after cancellation.
- **Rationale:** "Never reuse a finalized number" must not be misread as "a failed transaction permanently burns a number." Correctness requires commit to define issuance.
- **Consequences:** Sequence advancement is part of the same transaction as invoice persistence; a rollback undoes the sequence advance. The DB uniqueness constraint on `invoice_number` is the final integrity backstop.

### D-028: SQLite-compatible sequence locking (BEGIN IMMEDIATE)

- **Decision:** Sequence allocation uses SQLite semantics: the owning transaction is opened with `BEGIN IMMEDIATE`, then the sequence row is read and updated within it. PostgreSQL-style `SELECT ... FOR UPDATE` is not used. Two concurrent finalizations cannot obtain the same sequence; the `UNIQUE` constraint on `invoice_number` remains the backstop.
- **Rationale:** SQLite does not implement row-level `FOR UPDATE`; `BEGIN IMMEDIATE` acquires a reserved write lock that serializes writers correctly for a single-computer app.
- **Consequences:** Design/spec wording uses `BEGIN IMMEDIATE`; any `FOR UPDATE` language is removed.

### D-029: Restore reconciliation uses pre-restore trusted numbering state

- **Decision:** Invoice-number reconciliation after a restore is driven by the **trusted numbering high-water state captured from the CURRENT database immediately before restore**, not by the high-water mark inside the (older) backup. Process: capture current trusted high-water per numbering scope → safety-backup current DB → validate package → restore → enter RECONCILIATION_PENDING → for each scope advance the effective sequence to at least `trusted_high_water_mark + 1` → persist → only then allow new finalizations. Each numbering scope (company/FY/prefix) reconciles independently.
- **Rationale:** A restored older database cannot know about numbers issued after its backup was taken; relying on its internal high-water mark could reuse `46, 47, 48...`. The pre-restore captured state is the only trustworthy external source.
- **Consequences:** Restore captures and preserves reconciliation metadata that survives the DB replacement. This supersedes the earlier "restored DB high-water mark" wording in D-018.

### D-030: Explicit GST component rate configuration

- **Decision:** Tax configuration is explicit via a `TaxRateConfig` with `total_rate`, `cgst_rate`, `sgst_rate`, `igst_rate`. The calculation engine consumes the configured component rates. It does NOT derive CGST/SGST by blindly halving the total rate. The normal V1 config is 18% total → CGST 9% / SGST 9% / IGST 18%, but this is configuration, not a hardcoded rule.
- **Rationale:** Correctness must hold if component rates ever differ from a simple half-split; the engine should not assume symmetry.
- **Consequences:** Intra-state uses configured CGST + SGST; inter-state uses configured IGST. Still limited to `TaxTreatment.TAXABLE` in V1 (D-007/D-008 unchanged).

### D-031: PDF equivalence means content equivalence, not binary equality

- **Decision:** Reprint/re-export of a finalized invoice must reproduce identical invoice **content** (invoice UUID, number, date, company/customer snapshot, bill-to/ship-to, references, line items, quantities, rates, discounts, HSN/SAC, tax rates and amounts, totals, round-off, amount in words, terms, declaration, payment info, pinned asset versions, template version). It does **not** require byte-for-byte identical PDF files.
- **Rationale:** PDF binary metadata/object ordering can differ run-to-run; byte comparison would produce false failures for correct reprints.
- **Consequences:** PDF acceptance tests assert content/value equivalence (extracted text and structured values), never binary hash equality of the PDF.

### D-032: Unified Customer / Vendor (Party) master (V2 Feature 1)

- **Decision:** Customers and vendors are one `Party` entity with a `company_type` of `CUSTOMER`, `VENDOR`, or `CUSTOMER_VENDOR`. A dual-role business is a single record; it is never duplicated. `CUSTOMER_VENDOR` may carry both a customer and a vendor opening balance.
- **Rationale:** The client requires one master supporting both roles with no duplicate records (V2 F1 sections 1, 7).
- **Consequences:** New `parties` and `party_groups` tables (migration 0003). Role filters match inclusively (a Customer filter includes `CUSTOMER_VENDOR`). Business-facing role values are exactly `CUSTOMER` / `VENDOR` / `CUSTOMER_VENDOR` (supersedes the earlier `BOTH` naming in the in-progress `vendor-customer` spec).

### D-033: No GSTIN auto-fill; format-only, offline validation

- **Decision:** GSTIN is entered manually. The application never auto-derives PAN or state code from a GSTIN and never performs any online GST lookup. GSTIN/PAN/IFSC are validated by format only. GSTIN is optional unless the selected Registration Type requires it.
- **Rationale:** Client requirement (V2 F1 sections 2, 8) and the offline-first product invariant.
- **Consequences:** The earlier `vendor-customer` design requirement to auto-derive State/PAN from GSTIN is withdrawn; `PartyService` performs no derivation.

### D-034: Existing customers migrate into `parties`; `customers` retained as the invoice-facing projection

- **Decision:** Migration 0003 copies every existing `customers` row into `parties` with the **same UUID**. The legacy `customers` table is retained because `invoices.customer_id` references it and finalized invoice snapshots embed a `Customer`. Saving a customer-capable party mirrors it into `customers` (same id) via a `CustomerProjection`; vendor-only parties are not projected and therefore never appear as selectable sales customers.
- **Rationale:** Existing invoices (draft and finalized) must keep working and historical invoices must not lose their customer (V2 F1 sections 19, 20). Keeping the snapshot shape unchanged preserves finalized-invoice reproduction (D-010, D-031).
- **Consequences:** Two representations are kept in sync at the party-save boundary. The invoice module is otherwise unchanged. Archiving a party deactivates its customer projection so it drops out of new-invoice selection while history is preserved.

### D-035: Party opening balances stored as exact integer paise

- **Decision:** Customer and vendor opening balances are `Decimal` in the domain and persisted as integer paise, consistent with all other money (D-004). Balance direction is an explicit `DEBIT`/`CREDIT` type. No ledger is built in this feature; balances are stored cleanly for later payment/ledger modules to consume.
- **Rationale:** Client requirement (V2 F1 section 13) and the money-handling coding standard (never float).
- **Consequences:** `parties.customer_balance_paise` / `vendor_balance_paise` are INTEGER; amounts round-trip exactly.
