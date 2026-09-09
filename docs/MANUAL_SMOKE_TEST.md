# Manual Smoke-Test Checklist

**Purpose:** A manual smoke test covering only functionality that is actually implemented today. It is deliberately conservative: anything that depends on the (not-yet-built) user interface is marked **Not testable yet**.

**Important context — current build state:**
- The application entry point (`src/invoice_generator/main.py`) currently performs **foundation startup only**: it resolves the per-user data directory, creates the standard sub-directories, writes a startup log line, and exits. It returns exit code `0`.
- There is **no user interface yet**. `bootstrap.py` (composition root) and the `ui/` package (Tasks 43–51 in `.kiro/specs/invoice-generator/tasks.md`) are **not implemented**.
- The SQLite database is **not created or migrated on launch** yet; database initialization happens in the composition root, which does not exist yet. The `database/` folder is created but empty.
- The domain, calculation, persistence, and lifecycle logic (company, customer, draft/finalize/cancel/duplicate, numbering, payment status, exact money math, snapshots) **is implemented and covered by the automated test suite** (`pytest`, 314 tests passing at the time of writing). Those automated tests are **not** a substitute for a manual UI smoke test; they are noted here only to indicate where the logic lives.

Because there is no interactive UI, this checklist currently has **one** manually testable item (foundation startup). All user-visible workflows are marked **Not testable yet** with the task that will enable them.

---

## How to run (current entry point)

From the project root, using the project virtual environment:

```
.\.venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'src'); from invoice_generator.main import main; raise SystemExit(main())"
```

(There is no packaged executable or GUI to launch yet; packaging is Task 60.)

---

## 1. Application startup — TESTABLE

| # | Step | Expected result | Status |
|---|------|-----------------|--------|
| 1.1 | Run the entry point command above. | Process exits cleanly with exit code `0`; no traceback printed. | ☐ |
| 1.2 | Locate the per-user data directory: `%LOCALAPPDATA%\InvoiceGenerator`. | The directory exists and contains sub-folders `database\`, `exports\`, `backups\`, `assets\`, `logs\`. | ☐ |
| 1.3 | Open `%LOCALAPPDATA%\InvoiceGenerator\logs\app.log`. | Contains a line similar to `... INFO invoice_generator: Invoice Generator foundation initialized at ...`. | ☐ |
| 1.4 | Run the entry point a second time. | Still exits `0`; no error about existing directories; log gains another startup line (existing data preserved). | ☐ |
| 1.5 | Confirm no network access is required. | Startup completes with networking disabled. | ☐ |

**Note:** "Startup" here means the foundation entry point only. There is no window, dashboard, or menu to observe. A visible application shell arrives with Task 44 (PySide6 application shell).

---

## 2. Database initialization — NOT TESTABLE YET

- On-launch database creation/migration is **not wired into the entry point**. It will be added with the composition root (Task 43) and application shell (Task 44).
- **Not testable yet** (no launch path initializes the DB).
- (Automated coverage exists for the schema and migrations: `tests/integration/test_schema.py`, `tests/integration/test_migrations.py`. This is not a manual test.)

## 3. Company creation / configuration — NOT TESTABLE YET

- Requires the Settings screen (Task 46) and composition root (Task 43).
- **Not testable yet** (no UI).
- (Underlying logic: `Company` model, `CompanyRepository`, validation — covered by automated tests.)

## 4. Customer creation — NOT TESTABLE YET

- Requires the Customer screen (Task 47).
- **Not testable yet** (no UI).
- (Underlying logic: `Customer` model, `CustomerRepository` — covered by automated tests.)

## 5. Draft invoice creation — NOT TESTABLE YET

- Requires the Create/Edit Invoice screen (Task 48).
- **Not testable yet** (no UI).
- (Underlying logic: `InvoiceService.create_draft` — covered by `tests/integration/test_draft_lifecycle.py`.)

## 6. Incomplete draft save — NOT TESTABLE YET

- Requires the invoice form's "Save Draft" action (Task 48).
- **Not testable yet** (no UI).
- (Underlying logic: `InvoiceService.save_draft` returns non-blocking warnings for incomplete data — covered by automated tests.)

## 7. Draft reopen / edit — NOT TESTABLE YET

- Requires Invoice History (Task 50) plus the invoice form (Task 48).
- **Not testable yet** (no UI).
- (Underlying logic: `InvoiceService.get` + `save_draft` — covered by automated tests.)

## 8. Numeric input — NOT TESTABLE YET

- Requires the line-item entry table in the invoice form (Task 48).
- **Not testable yet** (no UI).
- (Underlying logic: exact `Decimal` money / quantity / percentage handling — covered by `tests/unit/test_money.py`.)

## 9. Calculation results — NOT TESTABLE YET

- Requires the invoice form's live totals display (Task 48).
- **Not testable yet** (no UI).
- (Underlying logic: line/tax/totals/round-off engine — covered by `tests/unit/test_calc_*.py`, `test_totals.py`, and the golden fixtures in `test_golden.py`. The two source invoices reproduce exactly: 043 → grand total ₹14,490.00 (round-off −₹0.40); 089 → ₹9,832.00 (round-off +₹0.24).)

## 10. Validation errors / warnings — NOT TESTABLE YET

- Requires field-level error/warning display in the UI (Tasks 45, 46, 47, 48).
- **Not testable yet** (no UI).
- (Underlying logic: permissive draft validation vs strict finalization validation — covered by `tests/unit/test_validation.py`, `tests/unit/test_finalize_validation.py`.)

## 11. Persistence after application restart — NOT TESTABLE YET

- Requires a UI that writes user data during a session and a launch path that opens the existing database. Neither exists yet (no UI; DB not opened on launch).
- **Not testable yet.**
- Partial adjacent check that *is* testable today: re-running the entry point (item 1.4) preserves the existing data directory and log — but this does not exercise invoice/customer data persistence.
- (Underlying logic: repository round-trips and snapshot immutability across reloads — covered by `tests/integration/test_repositories.py`, `test_snapshot_immutability.py`.)

---

## Findings (bugs / crashes / inconsistent state / usability)

- **No crashes or errors** observed running the entry point (exit code `0`, clean log, idempotent on re-run).
- **Expected gap, not a bug:** the entry point is non-interactive and exits immediately. This is by design for the current phase (foundation + core logic complete through Task 27; UI phases 7–8 not started).
- **Observation for the upcoming UI/composition work:** the entry point does not yet initialize/migrate the database on launch. When the composition root (Task 43) and shell (Task 44) are built, ensure launch runs `apply_pending(...)` against `database\invoices.db` so first run creates the schema. (Today the `database\` folder is created but remains empty.)
- **Usability:** not assessable yet — there is no interactive surface to evaluate.

---

## Summary

| Area | Status |
|------|--------|
| Application startup (foundation) | Testable (see section 1) |
| Database initialization | Not testable yet (Task 43/44) |
| Company creation/configuration | Not testable yet (Task 46) |
| Customer creation | Not testable yet (Task 47) |
| Draft invoice creation | Not testable yet (Task 48) |
| Incomplete draft save | Not testable yet (Task 48) |
| Draft reopen/edit | Not testable yet (Tasks 48, 50) |
| Numeric input | Not testable yet (Task 48) |
| Calculation results | Not testable yet (Task 48) |
| Validation errors/warnings | Not testable yet (Tasks 45–48) |
| Persistence after restart | Not testable yet (Tasks 43–48) |

Performing this manual smoke test does **not** complete or satisfy any future task; UI tasks remain to be implemented and verified on their own terms.
