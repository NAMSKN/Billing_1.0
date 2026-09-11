# Implementation Plan

Executable, fine-grained implementation plan for the Invoice Generator. Ordered by dependency across phases. Each task lists Objective, Dependencies, Scope, Files/modules, Tests, Acceptance evidence, and Definition of Done. Requirement references map to `requirements.md`; decisions to `DECISIONS.md`; open items to `OPEN_QUESTIONS.md`.

Do not implement application code from this document alone — implement one task at a time, satisfying its Definition of Done before moving on.

## Definition of Ready (DoR)

A task is Ready only when:
- its requirements and referenced decisions are known and not contradicted by an open question that blocks it;
- its dependencies are complete;
- any unresolved decision it touches is either resolved in `DECISIONS.md` or safely deferred per `OPEN_QUESTIONS.md` (with a stated safe interim);
- its acceptance criteria are clear and any needed fixtures/examples are available (or explicitly labeled pending).

## Definition of Done (DoD)

A task is Done only when:
- implementation is complete and matches the design;
- required tests exist and pass;
- `ruff` and `mypy` (strict) pass for the changed code;
- acceptance evidence is produced (test output, generated artifact, or documented spike result);
- no known architectural contradiction remains;
- docs (DECISIONS/OPEN_QUESTIONS/spec) are updated if behavior changed;
- existing passing tests remain green.
A checkbox alone is not evidence (DECISIONS D-022).

---

## PHASE 0 — Contract Reconciliation

- [x] 0. Reconcile requirements, architecture, invoice rules, PDF layout
  - **Objective:** Produce an internally consistent spec set aligned to the latest decisions.
  - **Dependencies:** none.
  - **Scope:** This reconciliation pass (requirements.md, design.md, tasks.md, steering, DECISIONS.md, OPEN_QUESTIONS.md).
  - **Files:** the spec set + steering + docs.
  - **Tests:** n/a (documentation).
  - **Acceptance evidence:** Specification Audit section at the end of this file.
  - **DoD:** all A–O audit checks pass or are recorded as tracked risks.

- [x] 1. Define unresolved decisions and project invariants
  - **Objective:** Capture intentional decisions and explicitly track unresolved items.
  - **Dependencies:** Task 0.
  - **Scope:** `DECISIONS.md` (D-001..D-022), `OPEN_QUESTIONS.md` (Q-001..Q-015).
  - **Files:** `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`.
  - **Tests:** n/a.
  - **Acceptance evidence:** every finding 3.1–3.22 maps to a decision or open question.
  - **DoD:** no invariant is left implicit.

## PHASE 1 — Foundation

- [x] 2. Project foundation
  - **Objective:** Package skeleton, platform-aware paths, logging, tooling.
  - **Dependencies:** Task 1.
  - **Scope:** already implemented (Task 1 of the prior plan): `pyproject.toml`, `.gitignore`, `src/invoice_generator/`, `config/paths.py`, `config/logging_setup.py`, `main.py`, pytest/ruff/mypy config.
  - **Files:** as above.
  - **Tests:** `tests/unit/test_paths.py`, `tests/unit/test_logging_setup.py`.
  - **Acceptance evidence:** 12 tests pass; ruff + mypy clean.
  - **DoD:** met (verified previously). Revisit only if metadata changes.

- [x] 3. Domain enums and types
  - **Objective:** Define lifecycle/payment/tax enums and `TaxTreatment`.
  - **Dependencies:** Task 2.
  - **Scope:** `InvoiceStatus`, `PaymentStatus`, `TaxType`, `TaxTreatment` (TAXABLE only in V1).
  - **Files:** `domain/enums.py`, `tests/unit/test_enums.py`.
  - **Tests:** enum membership/values; TaxTreatment extension point documented.
  - **Acceptance evidence:** unit tests pass.
  - **DoD:** enums used by later tasks; no lifecycle/payment mixing. _Requirements: 8, 13; DECISIONS D-007, D-008, D-015._

- [x] 4. Exact money/quantity/percentage representations
  - **Objective:** Lossless numeric conversions.
  - **Dependencies:** Task 3.
  - **Scope:** `Money` (Decimal) + `to_paise`/`from_paise`; quantity (scale 3) and percent (scale 2) scaled-integer helpers.
  - **Files:** `domain/money.py`, `tests/unit/test_money.py`.
  - **Tests:** round-trip property tests (Decimal↔paise, qty, percent); ROUND_HALF_UP behavior; rejects float inputs for money.
  - **Acceptance evidence:** property tests pass with exact equality.
  - **DoD:** no float in money paths. _Requirements: 5; DECISIONS D-004, D-005._

- [x] 4a. UUID entity-id strategy
  - **Objective:** Application-generated UUID4 identity with an injectable generator.
  - **Dependencies:** Task 2.
  - **Scope:** `IdGenerator` port (default UUID4); canonical-TEXT serialization + format validator; test UUID factory.
  - **Files:** `domain/ids.py`, `tests/unit/test_ids.py`, `tests/support/id_factory.py`.
  - **Tests:** UUID4 generated; canonical lowercase format; validator rejects non-canonical; deterministic via injected generator (no uuid monkeypatch).
  - **Acceptance evidence:** unit tests pass.
  - **DoD:** no AUTOINCREMENT anywhere; UUID distinct from invoice number. _Requirements: 30; DECISIONS D-023, D-024, D-025._

- [x] 5. Domain models
  - **Objective:** Core immutable models with UUID ids.
  - **Dependencies:** Task 4, 4a.
  - **Scope:** `Company`, `Customer`, `InvoiceLine`, `Invoice`, `InvoiceTotals`, `TaxSummaryRow`, `TaxRateConfig`, snapshot type; every entity has a UUID `id`; `Invoice.id` (UUID) distinct from `invoice_number` (nullable); bill-to/ship-to distinct.
  - **Files:** `domain/models.py`, `tests/unit/test_models.py`.
  - **Tests:** construction; UUID id present and immutable; id not regenerated on update; immutability of finalized values; distinct bill/ship; UUID ≠ invoice number.
  - **Acceptance evidence:** unit tests pass; mypy strict clean.
  - **DoD:** models consumed by services/engine later. _Requirements: 1, 2, 3, 4, 12, 30; DECISIONS D-023, D-025, D-030._

- [x] 6. Validation infrastructure (draft vs finalize)
  - **Objective:** Separate permissive draft validation from strict finalization validation.
  - **Dependencies:** Task 5.
  - **Scope:** GSTIN/email/IFSC format validators (offline); line/invoice validators; blocking vs warning classification.
  - **Files:** `domain/validation.py`, `tests/unit/test_validation.py`.
  - **Tests:** valid/invalid formats; draft allows incomplete (warnings); finalize blocks; due date not before invoice date; discount 0–100; qty>0; rate not negative.
  - **Acceptance evidence:** unit tests pass.
  - **DoD:** two distinct validation paths exist. _Requirements: 1.4, 2.3, 4.5, 8, 9.1; finding 3.1._

## PHASE 2 — Calculation Core

- [x] 7. Line-item calculation
  - **Objective:** Pure gross/discount/taxable per line.
  - **Dependencies:** Task 4, 5.
  - **Scope:** `calculate_line` producing gross, discount, taxable with defined quantization.
  - **Files:** `domain/calculation.py`, `tests/unit/test_calc_line.py`.
  - **Tests:** representative lines incl fractional quantity and discount.
  - **Acceptance evidence:** exact Decimal assertions pass.
  - **DoD:** pure, no I/O. _Requirements: 7.1._

- [x] 8. Tax determination
  - **Objective:** Derive TaxType from company state vs Place of Supply.
  - **Dependencies:** Task 3, 5.
  - **Scope:** `determine_tax_type`; reject unsupported treatments.
  - **Files:** `domain/calculation.py`, `tests/unit/test_tax_determination.py`.
  - **Tests:** intra vs inter; unsupported treatment raises.
  - **Acceptance evidence:** tests pass.
  - **DoD:** UI never decides tax type. _Requirements: 6, 11; DECISIONS D-008, D-009._

- [x] 9. Tax calculation
  - **Objective:** Per-line CGST/SGST or IGST.
  - **Dependencies:** Task 7, 8.
  - **Scope:** `calculate_line_tax` consuming explicit `TaxRateConfig` component rates; never both component sets on one line; never halve total_rate to derive CGST/SGST.
  - **Files:** `domain/calculation.py`, `tests/unit/test_calc_tax.py`.
  - **Tests:** intra uses configured cgst_rate/sgst_rate; inter uses configured igst_rate; other components zero; asymmetric-component config computed from config (not derived).
  - **Acceptance evidence:** tests pass.
  - **DoD:** consumes configured component rates. _Requirements: 6.4, 7.2, 6.3; DECISIONS D-030._

- [x] 10. Tax grouping (composite key)
  - **Objective:** Build reconciling tax summary.
  - **Dependencies:** Task 9.
  - **Scope:** group by {HSN/SAC + treatment + rate(s)}; reconcile to totals.
  - **Files:** `domain/calculation.py`, `tests/unit/test_tax_summary.py`.
  - **Tests:** multi-HSN, multi-rate grouping; reconciliation exact to the paise.
  - **Acceptance evidence:** reconciliation test passes.
  - **DoD:** never grouped by HSN alone. _Requirements: 7.3; finding 3.4._

- [x] 11. Totals and round-off
  - **Objective:** Aggregate totals + explicit round-off.
  - **Dependencies:** Task 9.
  - **Scope:** raw_total, rounded_total, round_off, grand_total.
  - **Files:** `domain/calculation.py`, `tests/unit/test_totals.py`.
  - **Tests:** positive and negative round-off cases.
  - **Acceptance evidence:** tests pass.
  - **DoD:** grand = raw + round_off. _Requirements: 7.4, 7.5._

- [x] 12. Amount in words
  - **Objective:** INR words for grand total and tax amount.
  - **Dependencies:** Task 11.
  - **Scope:** num2words wrapper; INR + paise formatting.
  - **Files:** `domain/amount_words.py`, `tests/unit/test_amount_words.py`.
  - **Tests:** whole-rupee and paise cases matching Req 22 examples.
  - **Acceptance evidence:** tests pass.
  - **DoD:** derived from final values only. _Requirements: 22._

- [x] 13. Golden regression fixtures
  - **Objective:** Lock in 043 and 089 aggregates.
  - **Dependencies:** Task 11.
  - **Scope:** aggregate fixtures; complete line-level labeled pending.
  - **Files:** `tests/fixtures/golden_invoices.py`, `tests/unit/test_golden.py`.
  - **Tests:** exact taxable/CGST/SGST/round-off/grand for both.
  - **Acceptance evidence:** both fixtures pass.
  - **DoD:** no fabricated line values. _Requirements: 28; OPEN_QUESTIONS Q-013._

## PHASE 3 — Persistence

- [x] 14. SQLite schema
  - **Objective:** Define tables with exact numeric columns and constraints.
  - **Dependencies:** Task 5.
  - **Scope:** all tables from design §7; UUID `TEXT NOT NULL` primary/foreign keys (no INTEGER/AUTOINCREMENT); INTEGER paise/scaled columns; FK, partial unique invoice_number, status CHECKs; per-scope `high_water_mark`.
  - **Files:** `infrastructure/db/schema.sql` (or migration 0001), `tests/integration/test_schema.py`.
  - **Tests:** table creation; constraint enforcement; PK/FK columns are TEXT UUID; no AUTOINCREMENT present.
  - **Acceptance evidence:** integration tests pass.
  - **DoD:** no REAL money columns; no INTEGER surrogate keys. _Requirements: 23, 30; DECISIONS D-004, D-023, D-024._

- [x] 15. Migrations
  - **Objective:** schema_version-based migration runner.
  - **Dependencies:** Task 14.
  - **Scope:** apply pending migrations at startup; never overwrite on version change.
  - **Files:** `infrastructure/db/migrations/`, `infrastructure/db/migrator.py`, `tests/integration/test_migrations.py`.
  - **Tests:** fresh init; idempotent re-run; version bump preserves data.
  - **Acceptance evidence:** tests pass.
  - **DoD:** deterministic ordering. _Requirements: 23.4._

- [x] 16. Repository contracts
  - **Objective:** Typed ports.
  - **Dependencies:** Task 5.
  - **Scope:** Protocols for Company/Customer/Invoice/Sequence/Asset/Settings repos.
  - **Files:** `domain/repositories.py`, `tests/unit/test_repository_protocols.py` (fakes).
  - **Tests:** in-memory fakes satisfy protocols.
  - **Acceptance evidence:** mypy verifies protocol conformance; tests pass.
  - **DoD:** services can depend on ports. _Requirements: 23; DECISIONS D-021._

- [x] 17. Repository implementations
  - **Objective:** SQLite repos with paise/scale conversion.
  - **Dependencies:** Task 14, 16.
  - **Scope:** CRUD + queries; conversions at boundary; parameterized SQL.
  - **Files:** `infrastructure/db/*_repository.py`, `tests/integration/test_repositories.py`.
  - **Tests:** persistence round-trip; exact paise round-trip; UUID canonical round-trip + FK relationships preserved; duplicate id rejected; summary-only invoice listing.
  - **Acceptance evidence:** integration tests pass.
  - **DoD:** no precision loss; UUIDs preserved unchanged. _Requirements: 5.4, 21.3, 23.2, 30; DECISIONS D-024._

- [x] 18. Constraints and integrity tests
  - **Objective:** Prove integrity rules.
  - **Dependencies:** Task 17.
  - **Scope:** unique finalized number, FK integrity, status CHECKs, draft cascade delete.
  - **Files:** `tests/integration/test_integrity.py`.
  - **Tests:** duplicate number rejected; orphan rejected; draft delete removes items; finalized not hard-deletable via normal path.
  - **Acceptance evidence:** tests pass.
  - **DoD:** DB enforces invariants. _Requirements: 23.3, 23.5._

## PHASE 4 — Invoice Numbering / Lifecycle

- [x] 19. Financial-year / numbering configuration
  - **Objective:** Configurable numbering (prefix, pad, start, FY scheme).
  - **Dependencies:** Task 17.
  - **Scope:** numbering_config persistence + formatter (safe interims for Q-002/Q-003/Q-004).
  - **Files:** `domain/numbering.py`, `application/settings_service.py`, `tests/unit/test_numbering_format.py`.
  - **Tests:** format `PREFIX/FY/NNN`; configurable pad/start; FY derivation from date.
  - **Acceptance evidence:** tests pass.
  - **DoD:** formatter configurable. _Requirements: 10.1, 10.3, 10.7; OPEN_QUESTIONS Q-002/003/004._

- [x] 20. Safe sequence allocation
  - **Objective:** Sequence allocation that participates in the caller's transaction; never MAX(), never its own COMMIT.
  - **Dependencies:** Task 19.
  - **Scope:** `numbering_service.allocate(conn/uow)` reads/updates the sequence row **within the caller's `BEGIN IMMEDIATE` transaction**; advances per-scope high-water; no BEGIN/COMMIT inside; no `SELECT ... FOR UPDATE`; contention (`BUSY`) retry left to the use case.
  - **Files:** `application/numbering_service.py`, `tests/integration/test_numbering_alloc.py`.
  - **Tests:** uniqueness under repeated allocation; FY rollover; backdated allocation case; two concurrent finalizations never get the same seq; allocation rolled back when outer tx rolls back (number NOT issued); no duplicate on failure.
  - **Acceptance evidence:** integration tests pass.
  - **DoD:** MAX() not used; allocator never commits its own tx. _Requirements: 10; DECISIONS D-012, D-026, D-027, D-028; OPEN_QUESTIONS Q-012._

- [x] 21. Draft lifecycle
  - **Objective:** Create/update/delete drafts with permissive validation.
  - **Dependencies:** Task 6, 17.
  - **Scope:** `invoice_service` draft ops; number stays NULL.
  - **Files:** `application/invoice_service.py`, `tests/integration/test_draft_lifecycle.py`.
  - **Tests:** save incomplete draft; edit; delete cascades; no number allocated.
  - **Acceptance evidence:** tests pass.
  - **DoD:** draft path never enforces finalize rules. _Requirements: 8._

- [x] 22. Finalization validation
  - **Objective:** Strict, ordered validation gate.
  - **Dependencies:** Task 6, 21.
  - **Scope:** strict validator ordering per Req 9.1; blocking errors.
  - **Files:** `application/invoice_service.py`, `tests/unit/test_finalize_validation.py`.
  - **Tests:** each missing/invalid required field blocks; passing set proceeds.
  - **Acceptance evidence:** tests pass.
  - **DoD:** distinct from draft validation. _Requirements: 9.1; finding 3.1._

- [x] 23. Atomic finalization
  - **Objective:** One outer transaction owned by the use case (D-026); number issued only on commit (D-027).
  - **Dependencies:** Task 11, 20, 22.
  - **Scope:** `InvoiceService.finalize` opens `BEGIN IMMEDIATE`, runs validate→resolve PoS→determine tax→calculate→allocate number→snapshot→pin asset/template→persist invoice/items/snapshot/sequence→COMMIT; ROLLBACK on any failure. No repository/service commits inside.
  - **Files:** `application/invoice_service.py`, `application/unit_of_work.py`, `tests/integration/test_finalization.py`.
  - **Tests:** success locks fields and issues number; injected failure at each step rolls back fully with no partial invoice; a number allocated then rolled back is reusable by a later successful finalize; no inner commit occurs.
  - **Acceptance evidence:** integration tests pass.
  - **DoD:** one outer transaction; issuance == commit; no inner commit. _Requirements: 9.2, 9.3, 9.4, 10.5, 10.9; DECISIONS D-026, D-027, D-028; design §22._

- [x] 24. Finalized snapshots
  - **Objective:** Immutable invoice-facing snapshot.
  - **Dependencies:** Task 23.
  - **Scope:** build/store structured + snapshot_json; reproduction reads snapshot only.
  - **Files:** `application/invoice_service.py`, `domain/models.py`, `tests/integration/test_snapshot_immutability.py`.
  - **Tests:** edit customer/company master → finalized snapshot unchanged; reproduction uses `snapshot_json` as authority (never live master tables); structured columns used only for listing.
  - **Acceptance evidence:** immutability test passes.
  - **DoD:** snapshot is authoritative; no live-master join for reproduction. _Requirements: 12; DECISIONS D-010._

- [x] 25. Cancellation
  - **Objective:** Cancel preserving record + number.
  - **Dependencies:** Task 23.
  - **Scope:** status CANCELLED, timestamp, reason; number not released; optional replacement link.
  - **Files:** `application/invoice_service.py`, `tests/integration/test_cancellation.py`.
  - **Tests:** cancel keeps same UUID and same number; not hard-deleted; state visible.
  - **Acceptance evidence:** tests pass.
  - **DoD:** history intact; UUID unchanged. _Requirements: 14, 30; DECISIONS D-016, D-025._

- [x] 26. Duplication
  - **Objective:** Duplicate → new draft only.
  - **Dependencies:** Task 21.
  - **Scope:** copy editable content; exclude id/final state/number/payment status.
  - **Files:** `application/invoice_service.py`, `tests/integration/test_duplication.py`.
  - **Tests:** duplicate is DRAFT with a NEW UUID and null number; original UUID/number unchanged.
  - **Acceptance evidence:** tests pass.
  - **DoD:** new UUID identity; number assigned only on finalize. _Requirements: 16, 30; DECISIONS D-017, D-025._

- [x] 27. Payment status
  - **Objective:** Independent payment status.
  - **Dependencies:** Task 23.
  - **Scope:** set UNPAID/PARTIAL/PAID; no financial/number change.
  - **Files:** `application/invoice_service.py`, `tests/integration/test_payment_status.py`.
  - **Tests:** FINALIZED+UNPAID valid; changing status leaves totals/number intact.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no ledger built. _Requirements: 13; DECISIONS D-015; OPEN_QUESTIONS Q-011._

## PHASE 5 — Early PDF / Printing Spike

- [x] 28. ReportLab proof of concept
  - **Objective:** Prove A4 PDF generation.
  - **Dependencies:** Task 2.
  - **Scope:** minimal sample invoice PDF from a hardcoded DTO (spike, not production layout).
  - **Files:** `spikes/pdf_poc.py`, `tests/integration/test_pdf_poc.py`.
  - **Tests:** file created, opens, A4 size.
  - **Acceptance evidence:** generated sample PDF + passing test.
  - **DoD:** ReportLab pipeline works. _Requirements: 26.1._

- [x] 29. Windows preview/open spike
  - **Objective:** Prove opening/previewing a PDF on Windows.
  - **Dependencies:** Task 28.
  - **Scope:** open the sample via default viewer; document approach.
  - **Files:** `spikes/windows_preview.py`, spike notes appended to OPEN_QUESTIONS Q-015.
  - **Tests:** manual/acceptance (documented) — cannot assert GUI in CI.
  - **Acceptance evidence:** documented result of opening on Windows.
  - **DoD:** approach chosen with evidence. _Requirements: 26; OPEN_QUESTIONS Q-015._

- [x] 30. Windows printing spike
  - **Objective:** Prove printing to a Windows printer.
  - **Dependencies:** Task 28.
  - **Scope:** OS print path; basic printer compatibility check.
  - **Files:** `spikes/windows_print.py`, spike notes.
  - **Tests:** manual/acceptance (documented).
  - **Acceptance evidence:** documented successful print (or documented limitation).
  - **DoD:** print approach chosen early. _Requirements: 26; finding 3.14._

## PHASE 6 — Production PDF

- [x] 31. Render DTO
  - **Objective:** Immutable render view model + builder.
  - **Dependencies:** Task 24.
  - **Scope:** `render_dto.py` + `pdf_service.build_dto(snapshot)`; preformatted strings; omit empty optionals; resolve pinned assets.
  - **Files:** `application/render_dto.py`, `application/pdf_service.py`, `tests/unit/test_render_dto.py`.
  - **Tests:** DTO built from snapshot; empty fields omitted; no DB access in renderer path.
  - **Acceptance evidence:** tests pass.
  - **DoD:** renderer input fully prepared. _Requirements: 19.8; DECISIONS D-011._

- [x] 32. Header / metadata components
  - **Objective:** Header/branding + invoice metadata block.
  - **Dependencies:** Task 28, 31.
  - **Scope:** company block, TAX INVOICE, number/date/due/PoS/terms.
  - **Files:** `infrastructure/pdf/components/header.py`, tests.
  - **Tests:** required text present; logo omitted gracefully when missing.
  - **Acceptance evidence:** component test passes.
  - **DoD:** matches PDF_LAYOUT header. _Requirements: 19.2, 19.5._

- [x] 33. Party sections
  - **Objective:** Bill-to / ship-to blocks.
  - **Dependencies:** Task 31.
  - **Scope:** distinct blocks even when identical.
  - **Files:** `infrastructure/pdf/components/parties.py`, tests.
  - **Tests:** both blocks rendered; long names/addresses wrap.
  - **Acceptance evidence:** test passes.
  - **DoD:** no clipping. _Requirements: 19.2, 19.3._

- [x] 34. References / logistics
  - **Objective:** Optional reference grid.
  - **Dependencies:** Task 31.
  - **Scope:** render only populated key/values.
  - **Files:** `infrastructure/pdf/components/references.py`, tests.
  - **Tests:** empty fields omitted (no `PO No:` blanks).
  - **Acceptance evidence:** test passes.
  - **DoD:** no empty labels. _Requirements: 19.6; finding 3.17._

- [x] 35. Line-item table
  - **Objective:** Mould/machining table.
  - **Dependencies:** Task 31.
  - **Scope:** columns #, Job/Mould, Operation, Description/Spec, HSN/SAC, Qty, Unit, Rate, Discount, Amount; numeric right-aligned.
  - **Files:** `infrastructure/pdf/components/line_items.py`, tests.
  - **Tests:** many lines; long spec wraps; special chars `& < > ₹ ×` render.
  - **Acceptance evidence:** test passes.
  - **DoD:** technical text never clipped. _Requirements: 19.3, 19.4._

- [x] 36. Tax summary
  - **Objective:** Composite-key tax summary block.
  - **Dependencies:** Task 10, 31.
  - **Scope:** render grouped summary reconciling to totals.
  - **Files:** `infrastructure/pdf/components/tax_summary.py`, tests.
  - **Tests:** values match engine; adapts to intra/inter columns.
  - **Acceptance evidence:** test passes.
  - **DoD:** consumes DTO only. _Requirements: 7.3, 19.2._

- [x] 37. Totals / words
  - **Objective:** Totals block + amounts in words.
  - **Dependencies:** Task 11, 12, 31.
  - **Scope:** prominent grand total; amount + tax in words.
  - **Files:** `infrastructure/pdf/components/totals.py`, tests.
  - **Tests:** grand total prominence; words match.
  - **Acceptance evidence:** test passes.
  - **DoD:** grand total most prominent. _Requirements: 19.7, 22._

- [x] 38. Payment / QR
  - **Objective:** Bank details + optional UPI QR.
  - **Dependencies:** Task 31.
  - **Scope:** render bank block; QR only if configured.
  - **Files:** `infrastructure/pdf/components/payment.py`, tests.
  - **Tests:** QR present when configured; omitted (no placeholder) when not.
  - **Acceptance evidence:** test passes.
  - **DoD:** graceful omission. _Requirements: 19.5, 20._

- [x] 39. Notes / terms / declaration / signature
  - **Objective:** Footer content blocks.
  - **Dependencies:** Task 31.
  - **Scope:** notes, terms, declaration, authorized signatory + pinned signature asset.
  - **Files:** `infrastructure/pdf/components/footer_blocks.py`, tests.
  - **Tests:** blocks render; missing signature degrades gracefully.
  - **Acceptance evidence:** test passes.
  - **DoD:** from snapshot only. _Requirements: 12.1, 17.5, 19.2._

- [x] 40. Pagination
  - **Objective:** Multi-page behavior.
  - **Dependencies:** Task 35.
  - **Scope:** BaseDocTemplate; repeat header; keep totals/signature together; page numbers.
  - **Files:** `infrastructure/pdf/renderer.py`, tests.
  - **Tests:** many-line invoice spans pages; header repeats; page numbers on each page.
  - **Acceptance evidence:** test passes.
  - **DoD:** rows not split where avoidable. _Requirements: 19.3._

- [x] 41. Long-content handling
  - **Objective:** Robustness for extreme content.
  - **Dependencies:** Task 40.
  - **Scope:** very long descriptions/names/addresses; readable-minimum font floor.
  - **Files:** `infrastructure/pdf/renderer.py`, tests.
  - **Tests:** no clipping; no sub-readable shrink.
  - **Acceptance evidence:** test passes.
  - **DoD:** readable minimum enforced. _Requirements: 19.3, 19.9._

- [x] 42. PDF regression tests
  - **Objective:** Programmatic PDF acceptance incl golden.
  - **Dependencies:** Task 37, 40.
  - **Scope:** end-to-end render of golden invoices; assert text/values; reprint asserts **content equivalence** (extracted text + structured values), never byte-for-byte PDF equality.
  - **Files:** `tests/integration/test_pdf_regression.py`.
  - **Tests:** file/opens/A4/page count/required text/golden totals present; two renders of the same finalized invoice are content-equivalent even if bytes differ.
  - **Acceptance evidence:** tests pass; sample PDFs generated.
  - **DoD:** golden totals appear in PDF; no binary-hash comparison. _Requirements: 19, 20.4, 28; DECISIONS D-031._

## PHASE 7 — Application Shell

- [x] 43. Composition root
  - **Objective:** Wire dependencies in one place; provide a reusable test composition factory.
  - **Dependencies:** Task 17, 23, 31.
  - **Scope:** `bootstrap.py` (connection→repos→services→controllers; constructor injection; injectable IdGenerator + clock). Plus `tests/support/build_test_app.py` reusing the same wiring so integration tests never hand-roll incompatible wiring.
  - **Files:** `bootstrap.py`, `tests/support/build_test_app.py`, `tests/integration/test_bootstrap.py`.
  - **Tests:** wiring builds; a use case runs end-to-end through the root with a temp DB, injected id generator and clock.
  - **Acceptance evidence:** integration test passes.
  - **DoD:** no service locator/global container; test factory shares production wiring. _Requirements: 25, 30; DECISIONS D-021, D-023._

- [x] 44. PySide6 application shell
  - **Objective:** MainWindow + navigation + worker-thread scaffolding.
  - **Dependencies:** Task 43.
  - **Scope:** window, 5-screen navigation shells, thread helper for long ops.
  - **Files:** `ui/main_window.py`, `ui/common/`, `main.py` update.
  - **Tests:** headless smoke (offscreen) that the window constructs.
  - **Acceptance evidence:** smoke test passes.
  - **DoD:** UI has no SQL/calculations. _Requirements: 25.1, 25.7._

- [x] 45. Error / notification handling
  - **Objective:** UI error boundary.
  - **Dependencies:** Task 43.
  - **Scope:** map typed errors → friendly messages; log technical detail (may include UUIDs, never secrets/PII).
  - **Files:** `ui/common/errors.py`, `application/errors.py`, tests.
  - **Tests:** each error type maps to a message; no stack trace in UI text; log written.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no raw traces surfaced. _Requirements: 25.4, 25.5._

## PHASE 8 — UI

- [x] 46. Company / settings UI
  - **Objective:** Company, bank, assets, numbering, tax defaults, notes/terms, paths.
  - **Dependencies:** Task 44, 11(company svc), 19.
  - **Files:** `ui/settings/`, tests (offscreen).
  - **Tests:** save/validate company; asset set as versioned; numbering config persisted; tax component rates configured (TaxRateConfig).
  - **Acceptance evidence:** tests pass.
  - **DoD:** graceful missing-asset handling. _Requirements: 1, 17, 10, 6.4; DECISIONS D-030._

- [x] 47. Customer UI
  - **Objective:** Customer list/add/edit/archive.
  - **Dependencies:** Task 44.
  - **Files:** `ui/customers/`, tests.
  - **Tests:** CRUD via service; archive hides from new-invoice selection; UUIDs not shown in normal UI.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no SQL in widgets. _Requirements: 2, 30.7._

- [x] 48. Create/edit invoice UI
  - **Objective:** Invoice form with live totals.
  - **Dependencies:** Task 44, 47, 7–12.
  - **Files:** `ui/invoices/invoice_form.py`, `ui/common/line_item_table.py`, tests.
  - **Tests:** customer auto-populate; live totals via engine; Save Draft (permissive) vs Finalize (strict); PoS override.
  - **Acceptance evidence:** tests pass.
  - **DoD:** calculations only via engine. _Requirements: 3, 4, 6, 7, 8, 9, 11, 25.2._

- [x] 49. Finalize / reprint workflow
  - **Objective:** Finalize, preview, export, print, reprint.
  - **Dependencies:** Task 23, 42, 30.
  - **Files:** `ui/invoices/`, `application/print_service.py`, `application/pdf_service.py`, tests.
  - **Tests:** finalize→preview identical to export; deterministic filename; reprint uses snapshot and is **content-equivalent** (not byte-identical); export failure doesn't modify invoice; number issued only on commit.
  - **Acceptance evidence:** tests pass.
  - **DoD:** one rendering implementation. _Requirements: 20; DECISIONS D-011, D-027, D-031._

- [x] 50. Invoice history
  - **Objective:** History list + search/filter + actions.
  - **Dependencies:** Task 44, 17.
  - **Files:** `ui/invoices/invoice_list.py`, tests.
  - **Tests:** columns; search by number/customer; date/status filters; summary-only load; view/preview/print/export/duplicate/cancel.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no hard delete of finalized/cancelled. _Requirements: 21._

- [x] 51. Dashboard
  - **Objective:** New invoice, recent, quick search, counts.
  - **Dependencies:** Task 44, 50.
  - **Files:** `ui/dashboard/`, tests.
  - **Tests:** recent invoices shown; new-invoice action.
  - **Acceptance evidence:** tests pass.
  - **DoD:** delegates to services. _Requirements: 25.1._

## PHASE 9 — Backup / Restore

- [x] 52. Safe backup creation
  - **Objective:** Consistent SQLite backup.
  - **Dependencies:** Task 17.
  - **Files:** `infrastructure/backup/backup.py`, `tests/integration/test_backup_create.py`.
  - **Tests:** backup uses SQLite online backup API; not a raw copy during writes; UUIDs preserved.
  - **Acceptance evidence:** tests pass.
  - **DoD:** consistent snapshot. _Requirements: 15.1, 30.6; DECISIONS D-018._

- [x] 53. Backup validation / manifest
  - **Objective:** Package + integrity manifest.
  - **Dependencies:** Task 52.
  - **Scope:** db + schema/app version + required asset versions + manifest (sizes, SHA-256).
  - **Files:** `infrastructure/backup/manifest.py`, tests.
  - **Tests:** manifest generated; tamper detected on validate.
  - **Acceptance evidence:** tests pass.
  - **DoD:** assets included. _Requirements: 15.2; DECISIONS D-019._

- [x] 54. Restore workflow
  - **Objective:** Capture pre-restore trusted state → validate → confirm → restore atomically.
  - **Dependencies:** Task 53.
  - **Scope:** before replacing data, capture current trusted per-scope high-water into reconciliation metadata stored outside the DB file (so it survives restore); then validate + restore.
  - **Files:** `infrastructure/backup/restore.py`, tests.
  - **Tests:** trusted state captured before restore and survives DB replacement; valid backup restores; invalid rejected.
  - **Acceptance evidence:** tests pass.
  - **DoD:** atomic restore; trusted state preserved. _Requirements: 15.3; DECISIONS D-029._

- [x] 55. Restore safety backup
  - **Objective:** Preserve current data before restore.
  - **Dependencies:** Task 54.
  - **Files:** `infrastructure/backup/restore.py`, tests.
  - **Tests:** safety backup created pre-restore.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no silent overwrite. _Requirements: 15.3._

- [x] 56. Numbering reconciliation after restore
  - **Objective:** Block reuse of post-backup numbers using pre-restore trusted state.
  - **Dependencies:** Task 20, 54.
  - **Scope:** RECONCILIATION_PENDING blocks issuance; per scope advance effective sequence to at least `trusted_high_water_mark + 1` using the captured pre-restore state (NOT the restored backup's internal mark); scopes reconcile independently; confirm then allow issuance.
  - **Files:** `application/numbering_service.py`, `infrastructure/backup/restore.py`, `tests/integration/test_restore_reconciliation.py`.
  - **Tests:** scenario backup=45, later 46/47/48 issued, restore → new issuance blocked until confirmed and sequence advanced past 48 (uses trusted state, not restored 45); multiple scopes reconcile independently.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no number reuse; trusted-state driven. _Requirements: 15.5; DECISIONS D-029; OPEN_QUESTIONS Q-009._

- [ ] 57. Restore failure recovery
  - **Objective:** Recover cleanly on failed restore.
  - **Dependencies:** Task 55.
  - **Files:** `infrastructure/backup/restore.py`, tests.
  - **Tests:** injected failure restores pre-restore state from safety backup.
  - **Acceptance evidence:** tests pass.
  - **DoD:** no data loss. _Requirements: 15.4._

## PHASE 10 — Offline / Packaging

- [ ] 58. Offline verification
  - **Objective:** Prove no runtime network dependency.
  - **Dependencies:** Task 49, 56.
  - **Scope:** test/guard asserting core workflows make no network call.
  - **Files:** `tests/integration/test_offline.py`.
  - **Tests:** monkeypatch socket to fail; create→finalize→PDF→search→backup→restore still succeed.
  - **Acceptance evidence:** tests pass with sockets disabled.
  - **DoD:** offline invariant proven. _Requirements: 24._

- [ ] 59. Service templates (if still in scope)
  - **Objective:** Optional reusable service descriptions (P2).
  - **Dependencies:** Task 48.
  - **Scope:** save/insert templates (UUID id); no inventory features.
  - **Files:** `application/settings_service.py`, `ui/invoices/`, tests.
  - **Tests:** insert template; line remains editable.
  - **Acceptance evidence:** tests pass (or task explicitly deferred).
  - **DoD:** no inventory scope creep. _Requirements: 29._

- [ ] 60. Windows packaging
  - **Objective:** Windows executable with data separation.
  - **Dependencies:** Task 44.
  - **Scope:** PyInstaller spec; bundle runtime + deps + assets.
  - **Files:** `packaging/` spec, build docs.
  - **Tests:** build produces an executable (documented).
  - **Acceptance evidence:** built artifact + notes.
  - **DoD:** user data outside install dir. _Requirements: 27; DECISIONS D-013._

- [ ] 61. Installation test
  - **Objective:** Verify clean install runs.
  - **Dependencies:** Task 60.
  - **Scope:** install on a clean Windows environment; first-run creates data dir.
  - **Files:** install test checklist/notes.
  - **Tests:** manual/acceptance (documented).
  - **Acceptance evidence:** documented successful install + first run.
  - **DoD:** data dir created; app opens. _Requirements: 27._

- [ ] 62. End-to-end acceptance
  - **Objective:** Full workflow on Windows.
  - **Dependencies:** Task 49, 56, 61.
  - **Scope:** create→finalize→PDF→print→backup→restore→reprint; verify a printed A4.
  - **Files:** acceptance checklist mapping to PDF_LAYOUT criteria.
  - **Tests:** manual/acceptance (documented) + automated where possible.
  - **Acceptance evidence:** documented end-to-end run incl a printed page.
  - **DoD:** all acceptance criteria met. _Requirements: 19, 20, 26._

- [ ] 63. Final regression
  - **Objective:** Full suite green before release.
  - **Dependencies:** all prior.
  - **Scope:** run unit+integration+PDF; golden fixtures; ruff+mypy.
  - **Files:** CI/local run.
  - **Tests:** entire suite.
  - **Acceptance evidence:** full-suite pass output; golden invoices pass.
  - **DoD:** no failing tests; no lint/type errors. _Requirements: 28; all._

---

## Specification Audit

Consistency audit after the reconciliation rewrite and the UUID/transaction/restore correction pass.

### Conflicts found and resolved (reconciliation pass)

1. **REAL vs exact money storage** → integer paise; scaled integers for qty/percent (D-004/D-005; Req 5; §3). _(3.2)_
2. **Tax summary grouped by HSN/SAC only** → composite key {HSN/SAC + treatment + rate(s)} with reconciliation test (Req 7.3; §6). _(3.4)_
3. **Draft vs finalization validation blurred** → two distinct validators (Req 8, 9; §10, §22; Tasks 6, 21, 22). _(3.1)_
4. **Numbering + restore reuse risk** → dedicated sequence + high-water mark + reconciliation gate (Req 10, 15; §9, §16; Tasks 20, 56). _(3.5, 3.6)_
5. **Snapshot relying on FKs** → full snapshot; reproduction reads snapshot only (Req 12; §11; D-010). _(3.7)_
6. **Assets as mutable paths** → versioned assets pinned per invoice (Req 17; D-019). _(3.8)_
7. **No template versioning** → template version on invoice (Req 18; D-020). _(3.9)_
8. **Special GST treatments as 0%** → out of scope, validation error (Req 6.5; D-008). _(3.3)_
9. **Coarse tasks** → fine-grained tasks with DoR/DoD + evidence. _(3.19, 3.20)_
10. **Late printing/composition** → early spike (Phase 5) + early composition root (Phase 7). _(3.14, 3.21)_

### Corrections applied (UUID / transaction / restore pass)

11. **UUID4 identity** for all entities, app-generated, canonical TEXT storage, no AUTOINCREMENT (Req 30; §3-identity, §7; Tasks 4a, 5, 14, 17; D-023/D-024).
12. **UUID distinct from invoice number** throughout (Req 30.9; §3; D-025).
13. **Application-owned transactions**: numbering/repos participate, never self-commit (§9, §22; Tasks 20, 23; D-026).
14. **SQLite locking** uses `BEGIN IMMEDIATE`; removed `FOR UPDATE` language (§9, §22; D-028).
15. **Number issued only on commit**; rollback → not issued/reusable; committed → permanent even after cancel (Req 10.5/10.9; §9, §22; D-027).
16. **Restore reconciliation uses pre-restore trusted state per scope**, not the older backup's internal mark (Req 15.3/15.5; §16; Tasks 54, 56; D-029; supersedes D-018 wording).
17. **Explicit GST component rates** via `TaxRateConfig`; no blind halving (Req 6.4; §4, §5; Tasks 9, 46; D-030).
18. **PDF reprint = content equivalence**, not byte-identical (Req 20.4; §18, §23; Tasks 42, 49; D-031).
19. **Snapshot is authoritative** for finalized reproduction (Req 12.3/12.4; §7, §11; Task 24; D-010).
20. **Asset resolution before Render DTO**; renderer never resolves assets/queries DB (Req 19.8; §17, §18; D-011).

### Correction-pass cross-checks (A–T)

- **A. UUID strategy consistent** across requirements/design/tasks — yes (Req 30; §3; Tasks 4a/5/14/17).
- **B. No entity uses AUTOINCREMENT** — yes; UUID TEXT PKs only (§7; Task 14).
- **C. UUID never confused with invoice number** — yes (Req 30.9; §3; D-025).
- **D. Numbering stays human-readable business numbering** — yes (§9; Req 10).
- **E. Finalization has one outer transaction** — yes (§22; Task 23).
- **F. No repo/service commits inside finalization** — yes (§9, §22; Tasks 20, 23; D-026).
- **G. SQLite locking language correct** — yes; `BEGIN IMMEDIATE`, no `FOR UPDATE` (§9, §22; D-028).
- **H. Failed finalization does not issue a number** — yes (Req 10.9; §22; D-027).
- **I. Successful commit permanently issues the number** — yes (Req 10.5; D-027).
- **J. Restore uses trusted pre-restore state** — yes (§16; Tasks 54, 56; D-029).
- **K. Multiple numbering scopes reconcile independently** — yes (§16; Req 15.5; Task 56).
- **L. GST component rates explicit** — yes (§4/§5; D-030).
- **M. PDF acceptance not binary-byte** — yes (§23; Tasks 42, 49; D-031).
- **N. Snapshot authoritative for reproduction** — yes (§11; Task 24; D-010).
- **O. Renderer never queries DB** — yes (§17, §18; D-011).
- **P. Renderer never recalculates** — yes (§18; D-006/D-011).
- **Q. Asset lookup before Render DTO** — yes (§17; D-011).
- **R. Integration tests use controlled test dependencies** — yes; `tests/support/build_test_app.py` shares production wiring (Task 43).
- **S. No new cloud/backend/web dependencies** — none introduced; offline invariant intact (Task 58).
- **T. Existing traceability intact** — design "Requirements Traceability" + per-task requirement refs preserved.

### Repository note

During this pass I found that the previous session's `tasks.md` had been silently truncated at Task 42 (Phases 7–10 and this audit were missing despite a prior success report). Phases 7–10 (Tasks 43–63) and this audit were restored and updated with the correction-pass changes.

### Unresolved questions (tracked, not guessed)

Q-001 future-dated policy; Q-002 number display format; Q-003 initial sequence/pad; Q-004 FY label/boundary; Q-005 GST rate UX; Q-006 multi-company; Q-007 default terms/declaration text; Q-008 template migration on reprint; Q-009 restore reconciliation UX (mechanism decided in D-029; only UX open); Q-010 cancelled watermark; Q-011 partial-payment tracking; Q-012 backdated numbering; Q-013 golden line-level source; Q-014 auto-backup policy; Q-015 Windows print approach.

### Architectural risks still remaining

- Windows print/preview depends on spike evidence (Tasks 29–30).
- num2words INR paise phrasing may need a thin wrapper (Task 12).
- Pre-restore trusted-state capture must be stored durably outside the DB file and survive restore (Task 54) — correct for single-computer V1 (D-001); multi-device sync would need rework (Q-006).
- Golden line-level fixtures remain aggregate-only until source PDFs are provided (Q-013).

### Task count

65 tasks: IDs 0–63 plus 4a (UUID entity-id strategy) across Phases 0–10.
