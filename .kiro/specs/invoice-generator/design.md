# Design Document

## Overview

Implementation architecture for the Invoice Generator: a local, Windows-first desktop billing application (Python + PySide6 + SQLite + ReportLab). This document turns `requirements.md` into a buildable design and defers to `DECISIONS.md` for intentional choices and `OPEN_QUESTIONS.md` for unresolved items.

Central invariant: **a finalized invoice is an immutable historical record** reproducible from a stored snapshot, independent of later master edits. There is **one** calculation engine, and the PDF renderer never touches the database and never recalculates.

Design principles: explicit domain models, small services, constructor injection via one composition root, repository ports over SQLite, `Decimal` in the domain with exact integer-paise storage, transactional finalization, and testable pure calculations. Avoid generic frameworks, service locators, god classes, global mutable state, and premature async.

The section order below matches the requested structure.

## 1. Layered Architecture

```
Presentation (PySide6)
    → Application services (use-case orchestration)
        → Domain (models, rules, pure calculations, repository ports)
            ← Infrastructure (SQLite repos, ReportLab renderer, printing, backup, filesystem)
```

Dependencies point inward; the domain depends on nothing outside itself. Hard boundaries (steering `architecture.md`): UI has no SQL and no calculations; one calculation engine owns money; the renderer consumes a DTO only.

### Package layout (under the existing `src/invoice_generator/` package from Task 1)

```
invoice_generator/
├── config/           # paths.py, logging_setup.py (exist)
├── domain/
│   ├── enums.py            # InvoiceStatus, PaymentStatus, TaxType, TaxTreatment
│   ├── money.py            # Money (Decimal) + paise conversions; Quantity/Percent scales
│   ├── models.py           # Company, Customer, InvoiceLine, Invoice, Totals, TaxSummaryRow, snapshot
│   ├── calculation.py      # pure calculation functions (engine core)
│   ├── numbering.py        # numbering value objects/formatter
│   └── repositories.py     # repository Protocols (ports)
├── application/
│   ├── calculation_service.py
│   ├── invoice_service.py  # draft/finalize/cancel/duplicate/list
│   ├── numbering_service.py
│   ├── company_service.py  customer_service.py  settings_service.py
│   ├── pdf_service.py      # builds render DTO, calls renderer
│   ├── print_service.py    backup_service.py
│   ├── render_dto.py       # immutable render view model
│   └── errors.py
├── infrastructure/
│   ├── db/                 # connection.py, migrations/, *_repository.py
│   ├── pdf/                # renderer.py, components/, styles.py
│   ├── printing/           # windows_print_adapter.py (+ port)
│   ├── backup/             # backup.py, manifest.py
│   └── assets/             # versioned asset store
├── ui/                     # dashboard/ customers/ invoices/ settings/ common/
├── bootstrap.py            # composition root
└── main.py                 # entry point (exists)
```

## 2. Domain Model

Master data: `Company`, `Customer`, invoice/numbering/terms configuration, versioned assets.
Transaction data: `Invoice` (+ snapshot), `InvoiceLine`, tax results, cancellation metadata, payment status.

Enums (Req/DECISIONS):
- `InvoiceStatus = DRAFT | FINALIZED | CANCELLED`
- `PaymentStatus = UNPAID | PARTIAL | PAID`
- `TaxType = INTRA_STATE | INTER_STATE`
- `TaxTreatment = TAXABLE` (only value in V1; extension point for D-008)

Lifecycle status and payment status are distinct fields and never merged.

Finalized domain values are immutable (frozen models). Bill-to and ship-to are always distinct concepts even when equal.

## 3. Exact Numeric Model

Per DECISIONS D-004/D-005:

| Value | Domain type | Storage | Scale |
|---|---|---|---|
| Money (amounts, rate) | `Decimal` | INTEGER paise | 2 dp → ×100 |
| Quantity | `Decimal` | INTEGER millis | 3 dp → ×1000 |
| Discount % | `Decimal` | INTEGER (hundredths) | 2 dp → ×100 |
| Tax % | `Decimal` | INTEGER (hundredths) | 2 dp → ×100 |

`domain/money.py` provides `to_paise(Decimal) -> int`, `from_paise(int) -> Decimal`, and analogous helpers for quantity/percent. Conversion happens **only** at the repository boundary; the domain and calculation engine work in `Decimal`. Round-half-up is applied only at the engine's defined quantization points. A property test asserts round-trip losslessness (UI→domain→DB→domain).

## 4. GST / Tax Determination

Place of Supply (state + code) is explicit on the invoice (Req 11) and defaults from the customer. Tax type:

```
tax_type = INTRA_STATE if company.state_code == place_of_supply.state_code else INTER_STATE
```

- INTRA_STATE → CGST = SGST = taxable × (rate/2); IGST = 0.
- INTER_STATE → IGST = taxable × rate; CGST = SGST = 0.

A single normal supply line never carries both. Only `TaxTreatment.TAXABLE` is supported in V1; requesting reverse charge/exempt/nil/zero-rated/export/SEZ is a validation error, never silent 0% (D-008). Tax type is computed in the engine, never inferred in the UI.

## 5. Calculation Engine

`domain/calculation.py` holds pure functions; `application/calculation_service.py` wraps them for use cases. Single source of truth (D-006). All money is `Decimal`, quantized 2 dp `ROUND_HALF_UP` at defined points.

Per line:
```
gross     = quantize(quantity * rate)
discount  = quantize(gross * discount_percent / 100)
taxable   = quantize(gross - discount)
cgst      = quantize(taxable * cgst_rate / 100)   # intra
sgst      = quantize(taxable * sgst_rate / 100)   # intra
igst      = quantize(taxable * igst_rate / 100)   # inter
```

Invoice aggregation and round-off:
```
total_taxable = Σ line.taxable
total_cgst/sgst/igst = Σ line.<component>
raw_total     = total_taxable + total_cgst + total_sgst + total_igst
rounded_total = round_to_rupee(raw_total)          # ROUND_HALF_UP
round_off     = rounded_total - raw_total           # may be + or -
grand_total   = raw_total + round_off               # == rounded_total
```

Golden checks (Req 28): 043 → 12280 + 1105.20 + 1105.20 = 14490.40, rounds to 14490.00, round_off −0.40. 089 → 8332 + 749.88 + 749.88 = 9831.76, rounds to 9832.00, round_off +0.24.

Pure, deterministic, no I/O/clock/network. Functions accept explicit inputs and return value objects.

## 6. Tax Grouping (Tax Summary)

Grouping key is the composite **{HSN/SAC + tax treatment + applicable rate(s)}**, not HSN/SAC alone (finding 3.4). Each `TaxSummaryRow` carries hsn_sac, treatment, rate(s), taxable_value, cgst/sgst/igst amounts, total_tax. The engine builds the summary by folding lines into the composite key, then asserts reconciliation: Σ summary taxable == total_taxable and Σ summary tax components == invoice tax totals. A test fails the build if reconciliation is off by any paise.

## 7. Persistence Model

SQLite in the per-user data dir (`config/paths.py`). Tables:

```
companies(id, ... , active)
customers(id, company_id, ... , is_active)
assets(id, kind, version, sha256, stored_path, created_at)
numbering_config(company_id, scope, prefix, pad_width, start_value, fy_scheme)
invoice_sequences(company_id, financial_year, prefix, next_sequence, high_water_mark)
invoices(id, company_id, customer_id, status, payment_status, invoice_number NULL-until-final,
         invoice_date, place_of_supply_state, place_of_supply_code, template_version,
         logo_asset_id, signature_asset_id, cancelled_at, cancel_reason, replacement_invoice_id,
         totals... (INTEGER paise), snapshot_json, created_at, updated_at)
invoice_items(id, invoice_id, sequence, job_ref, component, operation, description, specification,
              hsn_sac, quantity_millis, unit, rate_paise, discount_hundredths, tax_rate_hundredths,
              taxable_paise, cgst_paise, sgst_paise, igst_paise)
app_settings(key, value)
schema_version(version)
service_templates(id, ...)   -- optional / P2
```

Money columns are INTEGER paise; quantity/percent use the scaled integers from §3. The finalized snapshot is stored (structured columns for query + a `snapshot_json` capturing the full invoice-facing document for exact reproduction). Draft invoices have `invoice_number = NULL`.

Constraints: FK on all references; partial UNIQUE index on `invoice_number` where NOT NULL; CHECK on `status` and `payment_status`; draft delete cascades to `invoice_items`. Parameterized SQL only.

## 8. Repository Contracts

`domain/repositories.py` defines typed `Protocol` ports: `CompanyRepository`, `CustomerRepository`, `InvoiceRepository`, `SequenceRepository`, `AssetRepository`, `SettingsRepository`. Methods return/accept domain models (Decimal), not rows. SQLite implementations live in `infrastructure/db/` and own the paise/scale conversions. Services depend on the ports only, enabling in-memory fakes for unit tests.

## 9. Invoice Numbering Service

`numbering_service.py` allocates from `invoice_sequences` (never `MAX()`, D-012):

```
BEGIN IMMEDIATE
  row = SELECT ... FOR the (company, financial_year, prefix) scope   # created on first use with start_value
  seq = row.next_sequence
  UPDATE next_sequence = seq + 1,
         high_water_mark = MAX(high_water_mark, seq)
  number = format(prefix, financial_year, seq, pad_width)
COMMIT
```

Financial year derives from invoice date (Indian FY per Q-004). Backdated invoices allocate from the implied FY's sequence and are flagged (Q-012). Prefix changes affect only future allocations. Contention retries with a bounded backoff; on repeated failure it raises `NumberingError` without issuing a duplicate. The formatter is configurable (Q-002/Q-003). `high_water_mark` underpins restore reconciliation (§16).

## 10. Invoice Lifecycle Service

`invoice_service.py` orchestrates use cases against repositories + calculation + numbering services.

- **Draft:** create/update persist partial data with `status=DRAFT`, `invoice_number=NULL`; only lightweight structural validation; missing required data returns non-blocking warnings (Req 8).
- **Finalization:** strict, ordered, atomic (Req 9, §22).
- **Cancel / Duplicate / Payment status:** §13, §14, §12.

Draft validation and finalization validation are separate code paths (finding 3.1): drafts use a permissive validator returning warnings; finalization uses a strict validator returning blocking errors.

## 11. Finalized Snapshot Model

On finalize, the service builds an immutable snapshot capturing every invoice-facing value (company, customer, bill-to/ship-to, GSTIN/state, references, each line's job/mould/operation/spec/HSN-SAC/qty/unit/rate/discount, tax rates+amounts, totals, payment terms, due date, notes, terms, declaration, bank/UPI display, pinned asset versions, template version) — Req 12, D-010. Stored as structured columns (for listing/search) plus `snapshot_json` (for exact reproduction). Reproduction reads only the snapshot; it never joins to live `companies`/`customers`.

## 12. Payment Status

Independent field (D-015). Allowed: UNPAID/PARTIAL/PAID. Changing it updates only `payment_status` and `updated_at`; it never touches financials or the number. V1 has no ledger and no tracked paid amount (`PARTIAL` is a marker; amount tracking is Q-011).

## 13. Cancellation

`cancel(invoice_id, reason)` requires FINALIZED, sets `status=CANCELLED`, `cancelled_at`, `cancel_reason`; preserves snapshot and number; never deletes; may set `replacement_invoice_id` (Req 14, D-016). History and reprints show cancelled state (watermark is Q-010).

## 14. Duplication

`duplicate(invoice_id)` reads the source, copies editable business content (parties selection, references, lines, notes/terms) into a new `DRAFT`; excludes id, finalized state, final number, payment status (Req 16, D-017). The duplicate finalizes through the normal path and gets a fresh number.

## 15. Backup / Restore

`backup_service.py` (D-018): backup uses SQLite's online backup API to a consistent snapshot, then assembles a package = {db snapshot, schema/app version, required asset versions, manifest with sizes + SHA-256}. Never a raw copy during writes. Restore: validate manifest/integrity → create safety backup of current data → confirm → restore atomically → run numbering reconciliation (§16). On failure, roll back to the safety backup (Req 15). Auto-backup policy is opt-in (Q-014).

## 16. Restore Numbering Reconciliation

Critical integrity mechanism (finding 3.6, D-018). Each sequence row stores a monotonic `high_water_mark`. Because the app is single-computer, the high-water mark reflects the highest number ever issued. After a restore, the restored DB may be behind reality. The service:
1. Reads restored sequences and their high-water marks.
2. Enters a "reconciliation pending" state that **blocks new invoice issuance**.
3. Requires explicit operator confirmation; on confirm, advances `next_sequence` to at least `high_water_mark + 1` so post-backup numbers are never reused.
Exact UX (auto-advance vs manual) is Q-009; the safe interim (block + confirm + advance) is implemented.

## 17. PDF Render DTO

`application/render_dto.py` defines an immutable view model containing everything the renderer needs: preformatted strings, resolved (already-calculated) amounts, tax summary rows, party blocks, reference key/value pairs (empty ones omitted, Req 19.6), resolved asset bytes/paths for the pinned versions, template version, and page metadata. `pdf_service.py` builds it from the stored snapshot. The renderer receives only this DTO (D-011).

## 18. ReportLab Renderer

`infrastructure/pdf/renderer.py` uses a `BaseDocTemplate` with a frame + `PageTemplate` for repeating line-item headers and page numbers. Composed components (each a focused function/class consuming a slice of the DTO): Header/Branding, InvoiceMetadata, PartyDetails (Bill/Ship), ReferenceDetails, LineItemsTable, TaxSummary, Totals, AmountWords, Payment (Bank + optional UPI QR), Notes, Terms, Declaration, Signature, Footer — rendered in the Req 19.2 order.

Robustness (finding 3.16, Req 19): A4 portrait; long text wraps via `Paragraph` flowables (never clipped); tables split across pages repeating headers; special characters `& < > ₹ ×` handled (XML-escape for Paragraph, embed a font with ₹/× glyphs); missing logo/signature/QR omitted gracefully; grand total most prominent; no sub-readable font shrinking to force one page. The renderer never recalculates. Template version selects the layout variant (§19-template, Req 18).

## 19. PySide6 Presentation Layer

Screens (Req 25.1): Dashboard, Customers, Create/Edit Invoice, Invoice History, Settings. Each has a controller/view-model calling application services; widgets contain no SQL and no calculations (steering). Model/view tables for customer list, invoice history, and the line-item editor. Totals refresh live via `CalculationService`. Keyboard shortcuts Ctrl+N/S/P/F, Escape, Tab. Long operations (PDF, backup, restore) run on a worker thread (`QThread`/`QThreadPool`) to keep the UI responsive (Req 25.7). The invoice form clearly separates "Save Draft" (permissive) from "Finalize" (strict).

## 20. Composition Root

`bootstrap.py` is the single wiring point (D-021): open `SQLiteConnection` → construct repositories → construct services (constructor injection) → construct controllers → build `MainWindow`. Introduced early (Phase 7) so services/renderer are wired and testable before UI screens exist. No service locator, no global container, no module-level singletons holding mutable state.

## 21. Error Handling

`application/errors.py` defines typed errors: `ValidationError` (with field + blocking/warning), `NumberingError`, `FinalizationError`, `DatabaseError`, `PDFGenerationError`, `PrinterError`, `BackupError`, `RestoreError`. Infrastructure raises specific errors; services translate/propagate; the UI boundary maps them to friendly messages and logs technical detail to `logs/app.log` (no secrets/PII). Business code never opens dialogs (Req 25.4–25.6).

## 22. Transaction Boundaries

Finalization is one transaction (Req 9, finding 3.1): `BEGIN IMMEDIATE` → strict validate → allocate number (advancing high-water mark) → build + persist snapshot + items + totals → pin asset/template versions → `COMMIT`; any failure → `ROLLBACK` (no partial invoice, no consumed-but-reusable number). Draft saves are their own small transactions. Restore is transactional with a safety-backup fallback (§15–16).

## 23. Testing Strategy

Follows steering `testing-rules.md`:
- Unit: calculation engine (all paths), tax grouping reconciliation, round-off, amount-in-words, numbering formatting/allocation, validators (draft vs finalize), money round-trip (property test).
- Golden fixtures: 043 and 089 as **aggregate** fixtures (exact taxable/CGST/SGST/round-off/grand total); line-level fixtures labeled pending source (Q-013).
- Persistence/integration: repositories, constraints, migrations, cascade delete, paise round-trip.
- Lifecycle: draft edit, strict finalization + rollback, snapshot immutability, cancellation, duplication.
- Numbering: allocation, uniqueness, no reuse, FY rollover, backdated case, high-water mark.
- Restore: safe backup, manifest validation, safety backup, reconciliation gate, failure recovery.
- PDF: file/opens/A4/page count/required text/golden totals/optional-field omission/long-content wrap/special chars/missing assets.
- Windows acceptance: early spike + final end-to-end. Money asserts exact Decimal/paise; no network; deterministic (injected clock/paths).

## 24. Windows Printing / Preview Boundary

Proven **early** via a spike (Req 26, finding 3.14) before production UI: generate a sample PDF, open/preview it on Windows, and print to a Windows printer. `infrastructure/printing/` defines a `PrintPort` with a `WindowsPrintAdapter`; the chosen mechanism (shell print verb vs default-viewer open + OS print) is decided from spike evidence (Q-015). Business/UI layers depend on the port, not Windows APIs.

## 25. Packaging

PyInstaller Windows build bundling Python + PySide6 + ReportLab + qrcode + Pillow + num2words (D-013, Req 27). User data (db, backups, exports, assets, logs) resolves to the per-user data directory via `config/paths.py`, separate from the install dir, so upgrades preserve invoices. An installation test verifies a clean install starts, creates the data dir, and opens the app; an end-to-end acceptance verifies create → finalize → PDF → print → backup → restore on Windows.

## Requirements Traceability (summary)

Numeric model → Req 5 (§3). GST/scope/PoS → Req 6, 11 (§4). Engine/grouping/totals/round-off → Req 7, 28 (§5, §6). Draft vs finalize → Req 8, 9 (§10, §22). Numbering → Req 10 (§9). Snapshot → Req 12 (§11). Payment → Req 13 (§12). Cancellation → Req 14 (§13). Backup/restore/reconciliation → Req 15 (§15, §16). Duplication → Req 16 (§14). Assets → Req 17 (§7 assets, §17). Template → Req 18 (§18). PDF/robustness → Req 19 (§17, §18). Preview/print → Req 20, 26 (§18, §24). History → Req 21 (§19). Words → Req 22 (§5/§18). Persistence → Req 23 (§7, §8). Offline → Req 24 (all; no network). UI/errors → Req 25 (§19, §21). Packaging → Req 27 (§25). Templates P2 → Req 29 (§7 table).
