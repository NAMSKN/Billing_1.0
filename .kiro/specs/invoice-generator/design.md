# Design Document

## Overview

The Invoice Generator is a local, offline desktop application for a mould / mould-machining business. It is built in Python using a layered architecture: **PySide6** for the UI, **application services** for use-case coordination, a **domain layer** for business rules and calculations, **SQLite** for persistence, and **ReportLab** for deterministic A4 PDF generation.

The central design invariant is: **a finalized invoice is a stable financial record.** Its number, date, parties, line items, taxes, totals, terms, and declaration must be reproducible from locally stored data, independent of later master-data edits.

Two real invoices (`SE/26-27/043` and `SE/26-27/089`) act as golden regression fixtures whose calculated values must be reproduced exactly.

### Design Goals

- Correct, deterministic financial calculations using `Decimal` only.
- One authoritative calculation model consumed by UI, PDF, and persistence.
- Reliable local persistence with transactional invoice finalization.
- Clean separation of concerns: no SQL or GST math in the UI.
- Offline operation with no runtime network dependency.
- Testability at every layer.

### Non-Goals

No cloud, REST API, remote database, message queue, online payments, or live GSTIN verification. This is a billing tool, not an ERP.

## Architecture

### Layered Architecture

```text
Presentation (PySide6 UI)
        ↓  (controllers/view-models call services)
Application Services
        ↓  (services orchestrate domain + repositories)
Domain / Business Rules  ←—— pure, no I/O
        ↓
Repositories / Infrastructure (SQLite, PDF, Printing, Backup, FS)
        ↓
SQLite + File System + OS Printer
```

Hard rules enforced by the design:

- UI code MUST NOT contain financial rules or direct SQL (Req 20.6).
- Services depend on repository **interfaces** (ports), not concrete SQLite classes (Req 17, testability).
- The PDF renderer receives already-calculated data and performs no accounting (Req 7.6, 13.5).
- Exactly one `CalculationService` owns tax, discount, rounding, totals (Req 7.6).

### Project Structure

```text
invoice-generator/
├── src/
│   ├── main.py                # entry point
│   ├── bootstrap.py           # composition root (wires deps)
│   ├── domain/
│   │   ├── models/            # Company, Customer, Invoice, InvoiceLine, ...
│   │   ├── enums/             # InvoiceStatus, PaymentStatus, TaxType
│   │   ├── rules/             # calculation, numbering, validation rules
│   │   └── repositories/      # repository interfaces (ports)
│   ├── application/
│   │   ├── services/          # InvoiceService, CalculationService, ...
│   │   ├── dto/               # invoice view-model / render DTO
│   │   └── errors/            # domain/application error types
│   ├── infrastructure/
│   │   ├── database/          # sqlite_connection, migrations, repos
│   │   ├── pdf/               # invoice_renderer, components, tables
│   │   ├── printing/          # OS print adapters
│   │   ├── backup/            # backup/restore service
│   │   └── filesystem/        # platform-aware paths, asset loading
│   └── ui/
│       ├── dashboard/  customers/  invoices/  settings/  common/
├── tests/
│   ├── unit/  integration/  fixtures/
├── assets/
├── docs/
├── pyproject.toml
└── README.md
```

### Composition Root

`bootstrap.py` is the single place that wires dependencies:

```text
SQLiteConnection → Repositories → Services → Controllers/ViewModels → PySide6 UI
```

No other module instantiates infrastructure directly. Services receive dependencies via constructor injection (e.g. `InvoiceService(invoice_repo, customer_repo, calculation_service)`), which keeps unit testing straightforward.

## Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Language | Python 3.11+ | Application runtime |
| Desktop UI | PySide6 | Native desktop UI, model/view tables |
| Validation | Pydantic | Model/input validation |
| Database | SQLite (stdlib `sqlite3`) | Local relational persistence |
| PDF | ReportLab | Deterministic A4 invoice PDF |
| QR | qrcode | Optional UPI QR image |
| Images | Pillow | Logo / signature handling |
| Amount words | num2words | INR amount-to-words (custom INR formatting wrapper) |
| Testing | pytest | Unit / integration tests |
| Packaging | PyInstaller | Windows desktop executable |

No library is added without a confirmed requirement. Money uses `Decimal` exclusively; `float` is never used for monetary values.

## Domain Model

### Enums

```text
InvoiceStatus  = DRAFT | FINALIZED | CANCELLED
PaymentStatus  = UNPAID | PARTIAL | PAID
TaxType        = INTRA_STATE | INTER_STATE
```

Payment status is independent of invoice status (Req 11.1).

### Core Models

`Company` — name, address, gstin, state_name, state_code, email, phone, bank_name, account_number, branch, ifsc, authorized_signatory, logo_path, signature_path.

`Customer` — id, name, gstin, state_name, state_code, phone, email, billing_address, shipping_address, ship_to_state, godown_address, is_active. Bill-to and ship-to are always preserved as distinct concepts even when identical (Req 2.5).

`InvoiceLine` — sequence, job_or_mould_reference, component_or_part, operation, description (required), specification, hsn_sac, quantity (Decimal), unit, rate (Decimal), discount_percent (Decimal), tax_rate (Decimal), plus calculated amounts (gross, discount_amount, taxable_amount, cgst, sgst, igst, line_total).

`Invoice` — identity (id, invoice_number, invoice_date), parties (company snapshot + customer snapshot), references (PO, challan, delivery note, dispatch, vehicle, destination, terms of delivery, ...), commercial (payment_terms, due_date, place_of_supply), line_items[], totals, notes, terms, declaration, status, payment_status.

`InvoiceTotals` — total_taxable, total_cgst, total_sgst, total_igst, raw_total, round_off, grand_total, tax_type, plus grand_total_words and tax_amount_words.

`TaxSummaryRow` — hsn_sac, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_tax. Grouped by HSN/SAC (Req 6.3, 8.5).

### Snapshot Principle

On finalization, the invoice stores an invoice-facing snapshot of company and customer values, addresses, GSTIN/state, all line values, tax rates, calculated taxes, totals, notes, terms, and declaration (Req 16.1). This is stored as snapshot columns alongside the foreign keys, so later master edits never change historical invoices (Req 16.2). SQLite is the source of truth; the PDF is a generated representation (Req 16.3).

## Calculation Engine (CalculationService)

The single authoritative calculation model (Req 7.6). All monetary math uses `Decimal` with explicit quantization to 2 decimal places using `ROUND_HALF_UP`.

### Per-line calculation

```text
gross_amount    = quantity * rate
discount_amount = gross_amount * (discount_percent / 100)
taxable_amount  = gross_amount - discount_amount
```

Each intermediate monetary result is quantized to 2 dp before the next monetary step, so downstream sums are exact.

### Tax determination

```text
if company.state_code == place_of_supply_state_code:  tax_type = INTRA_STATE
else:                                                  tax_type = INTER_STATE
```

- INTRA_STATE → CGST + SGST (each = tax_rate / 2), IGST = 0.
- INTER_STATE → IGST (= tax_rate), CGST = SGST = 0.

A single normal supply line never carries CGST/SGST and IGST simultaneously (Req 8.3). Tax rates are configurable, never hardcoded to 9/9 or 18 (Req 8.4).

### Per-line tax

```text
cgst_amount = taxable_amount * cgst_rate / 100    (intra-state)
sgst_amount = taxable_amount * sgst_rate / 100    (intra-state)
igst_amount = taxable_amount * igst_rate / 100    (inter-state)
```

### Invoice aggregation and round-off

```text
total_taxable = Σ line.taxable_amount
total_cgst    = Σ line.cgst_amount
total_sgst    = Σ line.sgst_amount
total_igst    = Σ line.igst_amount
raw_total     = total_taxable + total_cgst + total_sgst + total_igst
rounded_total = raw_total rounded to nearest whole rupee (ROUND_HALF_UP)
round_off     = rounded_total - raw_total          # may be + or -
grand_total   = raw_total + round_off               # == rounded_total
```

### Golden fixture verification

- Invoice 043: taxable 12,280.00; CGST 1,105.20; SGST 1,105.20; round_off −0.40; grand 14,490.00.
  - raw = 12280 + 1105.20 + 1105.20 = 14490.40; rounded = 14490.00; round_off = −0.40. ✓
- Invoice 089: taxable 8,332.00; CGST 749.88; SGST 749.88; round_off +0.24; grand 9,832.00.
  - raw = 8332 + 749.88 + 749.88 = 9831.76; rounded = 9832.00; round_off = +0.24. ✓

These are encoded as pytest regression fixtures (Req 21).

### Amount in words

A dedicated helper wraps `num2words` (Indian numbering) to produce:
- Grand total: `INR Fourteen Thousand Four Hundred Ninety Only`.
- Tax amount with paise: `INR ... and Forty Paise Only`.

Words are derived from final Decimal values only; never entered manually (Req 9.3).

## Invoice Numbering

A dedicated `invoice_sequences` table holds (company_id, financial_year, prefix, next_sequence). Numbering never uses `MAX(invoice_number)` (Req 4.2).

At finalization, within a single transaction:

```text
BEGIN
  reserve next_sequence for (company, financial_year)  -- UPDATE ... RETURNING / atomic increment
  build invoice_number = PREFIX/FY/zero-padded-sequence
  persist invoice header + lines + snapshot + totals
COMMIT   (ROLLBACK on any failure)
```

Cancelling does not free a number; duplicating creates a new draft that receives its own number at finalization (Req 4.5, 4.6).

## Application Services

| Service | Responsibility |
|---|---|
| `CompanyService` | Load/save the single active company; validate GSTIN/email/IFSC formats. |
| `CustomerService` | CRUD + search customers; archive (is_active=false) instead of delete. |
| `CalculationService` | Sole owner of line/tax/round-off/totals + amount-in-words. |
| `InvoiceService` | Create/edit draft, validate, finalize (transactional), cancel, duplicate, list/search. Orchestrates numbering + calculation + snapshot. |
| `PDFService` | Build render DTO from stored invoice, invoke `InvoiceRenderer`, return PDF bytes/file. |
| `PrintService` | Print an existing PDF via a platform print adapter. |
| `BackupService` | Timestamped backup, validated restore with safety backup + confirmation. |
| `SettingsService` | Persist company/bank/tax defaults, numbering config, default notes/terms, export/backup paths. |

Services raise typed errors (`ValidationError`, `DatabaseError`, `PDFGenerationError`, `PrinterError`, `BackupError`) that the UI converts to friendly messages (Req 20.4). Business code never shows dialogs directly.

## Persistence

### Tables

```text
companies            (single active company; multi-company deferred)
customers            (is_active flag)
invoices             (fk company_id, customer_id + snapshot columns, status, payment_status, totals, notes, terms, declaration)
invoice_items        (fk invoice_id, all structured + calculated fields)
invoice_sequences    (company_id, financial_year, prefix, next_sequence)
app_settings         (key/value or typed settings; defaults, paths, numbering config)
schema_version       (migration tracking)
service_templates    (optional, P2)
```

### Integrity & access rules

- Parameterized queries only; no string-built SQL (Req 17.2).
- Foreign keys ON; unique constraint on invoice_number; CHECK constraints on status/payment_status enums (Req 17.3).
- Draft delete cascades to its items; finalized/cancelled invoices are not hard-deleted through normal workflows (Req 15.6, 17.5).
- Repository interfaces live in `domain/repositories`; SQLite implementations in `infrastructure/database`. Services depend on the interfaces.

### Migrations

On startup: resolve app data dir → open SQLite → read `schema_version` → apply pending migrations in order → open app. An existing database is never overwritten due to a version bump (Req 17.4).

## PDF Generation

`InvoiceRenderer` consumes a prepared render DTO (never the DB) and composes focused components in vertical order (Req 13.2):

```text
HeaderRenderer → InvoiceMetadata → PartyDetails(Bill/Ship) → ReferenceDetails
→ LineItemsTable → TaxSummary → Totals → AmountWords → Payment(Bank/UPI QR)
→ Notes → Terms → Declaration → Signature → Footer/PageNumber
```

Key layout decisions (from PDF_LAYOUT.md):

- A4 portrait, ~12–15 mm margins, grayscale-safe, ReportLab tables/flowables with a `BaseDocTemplate` for repeating headers and page numbers.
- Line-item table columns: #, Job/Mould, Operation, Description/Specification, HSN/SAC, Qty, Unit, Rate, Discount, Amount. Numeric columns right-aligned; technical text wraps and is never clipped (Req 13.3).
- Grand total is the largest, boldest monetary value with a distinct border (Req 13.4).
- Empty optional fields are omitted, not printed as blank labels (Req 13.7).
- Multi-page: repeat line-item header, avoid row splits, keep totals + signature together, page numbers on every page (Req 13.6).
- UPI QR rendered only when configured; no blank placeholder (Req 11.4).

### Preview / Export / Print

One rendering implementation feeds preview, export, and print (Req 14.1). Export uses a deterministic filename derived from the invoice number, e.g. `INV_SE_26-27_043.pdf`, with a user-selectable path (Req 14.2). Printing sends the generated PDF to the OS printer through a replaceable adapter (Windows first) (Req 14.3). Reprint/re-export of a finalized invoice uses stored data and produces identical content (Req 14.4).

## UI Design

Five screens (Req 20.1), each backed by a controller/view-model that calls services (no SQL/GST in widgets):

- **Dashboard** — New Invoice, recent invoices, quick search, basic counts.
- **Customers** — list (model/view table), search, add/edit/view/duplicate, archive.
- **Create/Edit Invoice** — sections for Customer, Invoice details, References, Mould/job info, Line items (editable table), Taxes, Totals, Notes, Terms; actions Save Draft, Finalize, Preview, Print, Export PDF, Cancel.
- **Invoice History** — search + filters (number, customer, date range, status), sortable list, view/preview/print/export/duplicate/cancel.
- **Settings** — Company, Bank, Logo, Signature/stamp, Invoice numbering, Default tax, Default notes, Default terms, Backup/Restore, Export location.

Interaction rules:

- Keyboard shortcuts: Ctrl+N/S/P/F, Escape, Tab/Shift+Tab; line-item entry minimizes mouse use (Req 20.2).
- Field-level validation messages; blocking errors vs non-blocking warnings distinguished (Req 20.3, 36 of INVOICE_RULES).
- Totals update live via CalculationService as line items change.
- Long operations (large PDF, backup, restore) run off the UI thread (Req 20.7).

## Error Handling

Errors are handled at layer boundaries. Infrastructure raises specific errors; services translate/propagate typed application errors; UI maps them to business-friendly messages and never shows raw stack traces (Req 20.4). Technical detail is written to `logs/app.log`; passwords/credentials/unneeded PII are never logged (Req 20.5, 32).

## File Storage

Platform-aware user data directory (Req 17.1, 23.2):

```text
<AppData>/InvoiceGenerator/
├── database/invoices.db
├── exports/
├── backups/
├── assets/ (logo, signature)
└── logs/app.log
```

No hardcoded Unix paths; a path abstraction resolves the OS-appropriate location. User data is separate from the install directory so upgrades never destroy invoices (Req 23.2).

## Backup & Restore

`BackupService` creates timestamped copies of `invoices.db`, retains multiple versions, and supports optional automatic backups. Restore validates the selected backup, takes a safety backup of the current DB, requires confirmation, then swaps and reloads — never a silent overwrite (Req 18).

## Testing Strategy

Tests follow the architecture (ARCHITECTURE.md §41):

- **Unit** — GST/discount/round-off calculations, amount-in-words, invoice numbering, validation, domain rules. Includes the two golden invoice fixtures asserting exact taxable/CGST/SGST/round-off/grand-total values (Req 21).
- **Repository/integration** — customer & invoice persistence, transactional finalization + rollback, sequence handling, migrations, draft cascade delete.
- **Service** — create/finalize/cancel/duplicate invoice, search/filter, backup/restore orchestration, snapshot integrity (editing a master does not change a finalized invoice).
- **PDF** — file generated, opens, A4 page size, correct page count, required text/values present, golden invoice totals reproduced. Visual inspection (alignment, branding, QR, signature, page breaks, B/W print) is a manual acceptance step.

The two real invoices are permanent regression fixtures for both calculation and PDF value checks.

## Requirements Traceability (summary)

- Calculation/round-off/words → Req 7, 9, 21; CalculationService.
- GST intra/inter + tax summary → Req 8; CalculationService + TaxSummary.
- Numbering → Req 4; invoice_sequences + transactional reservation.
- Lifecycle + snapshot immutability → Req 10, 16; InvoiceService + snapshot columns.
- PDF layout/preview/print → Req 13, 14; PDFService + InvoiceRenderer + PrintService.
- Persistence/integrity/migrations → Req 17; SQLite repos + schema_version.
- Backup/restore → Req 18; BackupService.
- Offline → Req 19; no network code anywhere.
- UI/usability/errors/logging → Req 20; controllers + typed errors + logging.
- Company/Customer masters → Req 1, 2; CompanyService/CustomerService.
- Packaging/data separation → Req 23; PyInstaller + user data dir.
