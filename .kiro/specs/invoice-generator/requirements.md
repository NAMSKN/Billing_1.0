# Requirements Document

## Introduction

This document defines testable product requirements for a **local, Windows-first desktop billing application** for a mould / mould-machining business in India. The operator maintains company and customer master data, creates GST tax invoices with mould/machining line items, finalizes them into immutable records, generates professional A4 PDF invoices, prints them locally, and manages history with safe backup and restore.

The application is 100% offline: no cloud, server, REST API, remote database, or online payment gateway. Kiro is the development environment, not the runtime. The runtime stack is Python + PySide6 + SQLite + ReportLab (see `DECISIONS.md`).

Requirements describe observable behavior and use EARS-style acceptance criteria. They defer to the source hierarchy: Product Requirements → Invoice Rules → Architecture → PDF Layout → `DECISIONS.md` → `OPEN_QUESTIONS.md`. Items in `OPEN_QUESTIONS.md` are not decided here and must not be guessed.

### Key distinctions used throughout

- **Draft** invoices may be incomplete and freely edited (Req 8).
- **Finalization** is strict and atomic (Req 9).
- **Invoice lifecycle** (DRAFT / FINALIZED / CANCELLED) is independent of **payment status** (UNPAID / PARTIAL / PAID) (Req 13).
- Money is `Decimal` in the domain and exact integer paise in storage (Req 5).
- Every entity has an internal **UUID4** identity, distinct from the human-readable **invoice number** (Req 30).

---

## Requirements

### Requirement 1: Company / Supplier Master

**User Story:** As a billing operator, I want to configure my company once, so that every invoice carries accurate supplier, bank, and branding information.

#### Acceptance Criteria

1. WHEN the operator opens Settings THEN the system SHALL allow entry of company name, full address, GSTIN/UIN, state name, state code, email, and phone.
2. WHEN the operator saves company settings THEN the system SHALL support bank name, account number, branch, IFSC, UPI ID, authorized signatory name, and references to logo/signature/stamp assets.
3. WHEN company name is empty THEN the system SHALL block the save with a field-level message.
4. WHEN a GSTIN, email, or IFSC value is entered THEN the system SHALL validate its format offline and report format errors near the field; no network call SHALL be made.
5. WHEN the operator sets a logo/signature/stamp THEN the system SHALL store it as a versioned asset (per Req 17), not a bare mutable path.
6. WHERE V1 is concerned THEN the system SHALL support exactly one active company while retaining a company scope key for future multi-company use (OPEN_QUESTIONS Q-006).

### Requirement 2: Customer Master

**User Story:** As a billing operator, I want to save customers once and reuse them, so that I do not retype details.

#### Acceptance Criteria

1. WHEN the operator creates a customer THEN the system SHALL require name, billing address, and state (name + code).
2. WHEN the operator creates a customer THEN the system SHALL support GSTIN/UIN, phone, email, ship-to/consignee address and state, and an optional godown address as optional fields.
3. WHEN a GSTIN or email is entered THEN the system SHALL validate its format offline and reject invalid values with a field-level message.
4. WHEN ship-to equals bill-to THEN the system SHALL still preserve both as distinct concepts.
5. WHEN the operator selects an existing customer on an invoice draft THEN the system SHALL populate name, GSTIN, billing address, shipping/consignee info, and state/state code into the draft.
6. WHEN a customer is retired THEN the system SHALL mark it inactive (is_active = false) rather than hard-deleting it, exclude it from default new-invoice selection, and keep it visible on historical invoices.

### Requirement 3: Invoice Header and References

**User Story:** As a billing operator, I want complete header and reference fields, so that invoices match real-world requirements.

#### Acceptance Criteria

1. WHEN the operator creates a new invoice THEN the system SHALL default the invoice date to the current local date.
2. WHEN the operator edits references THEN the system SHALL support (all optional) delivery note no./date, reference no./date, buyer's order/PO no. and date, dispatch doc no./date, LR-RR/bill of lading, motor vehicle no., dispatched-through, destination, terms of delivery, and other references.
3. WHEN the operator edits commercial fields THEN the system SHALL support payment terms, due date, and an explicit Place of Supply (state + code).
4. WHEN a due date is supplied THEN the system SHALL reject a due date earlier than the invoice date.
5. WHERE future-dated invoices are concerned THEN the system SHALL treat a future invoice date as a non-blocking warning pending decision (OPEN_QUESTIONS Q-001) and SHALL NOT hardcode a block.
6. WHEN Place of Supply is not explicitly set THEN the system SHALL default it from the selected customer while allowing override (per Req 11).

### Requirement 4: Mould / Machining Line Items

**User Story:** As a billing operator, I want structured mould/machining fields plus free text, so that technical detail stays clear.

#### Acceptance Criteria

1. WHEN the operator adds a line item THEN the system SHALL support job/mould reference, component/part, operation/process, description, specification, HSN/SAC, quantity, unit, rate, and discount percent.
2. WHEN structured fields are used THEN the system SHALL still keep a free-text description available and SHALL NOT clip or drop technical text.
3. WHEN the operator adds line items THEN the system SHALL support multiple lines on one invoice, each with its own rate, tax rate, and calculated taxable amount.
4. WHEN the operator selects a unit THEN the system SHALL allow arbitrary units (e.g. NOS, MM, PCS, KG, SET, HOURS) per line, without hardcoding one unit.
5. WHEN a line is validated for finalization THEN the system SHALL require a non-empty description, require HSN/SAC for a taxable line, require quantity greater than zero, reject a negative rate, and require discount percent between 0 and 100 inclusive.
6. WHEN serial numbers are needed THEN the system SHALL assign them automatically in entry order.

### Requirement 5: Exact Numeric Representation

**User Story:** As a billing operator, I want exact money math, so that totals never drift.

#### Acceptance Criteria

1. WHEN money is calculated in the domain THEN the system SHALL use `Decimal` and SHALL NOT use binary floating point.
2. WHEN money is persisted THEN the system SHALL store it as integer paise (INTEGER), never REAL (DECISIONS D-004).
3. WHEN quantity, rate, discount percent, or tax percent are persisted THEN the system SHALL use the fixed lossless scales defined in DECISIONS D-005 (rate as paise; quantity scale 3; percentages scale 2).
4. WHEN a value moves UI → domain → database → domain → calculation → PDF THEN the system SHALL NOT lose precision at any boundary.
5. WHEN monetary values are displayed THEN the system SHALL present them to two decimal places.

### Requirement 6: GST Determination and Scope

**User Story:** As a billing operator, I want correct GST applied automatically, so that intra- and inter-state invoices are taxed properly.

#### Acceptance Criteria

1. WHEN company state and Place of Supply state are the same THEN the system SHALL apply CGST + SGST (intra-state).
2. WHEN they differ THEN the system SHALL apply IGST (inter-state).
3. WHEN taxing a single normal supply line THEN the system SHALL populate only the applicable components and SHALL NOT apply CGST+SGST and IGST simultaneously.
4. WHEN tax rates are used THEN the system SHALL consume explicit configured component rates (`total_rate`, `cgst_rate`, `sgst_rate`, `igst_rate`) and SHALL NOT derive CGST/SGST by blindly halving the total rate, nor hardcode 9/9 or 18 (DECISIONS D-030).
5. WHERE reverse charge, exempt, nil-rated, zero-rated, export, or SEZ treatments are requested THEN the system SHALL treat them as out of scope for V1 and SHALL NOT silently model them as generic 0% (DECISIONS D-008).
6. WHEN tax type is determined THEN the system SHALL derive it from company state vs the explicit Place of Supply and SHALL NOT infer it inside UI logic.

### Requirement 7: Tax Calculation, Grouping, Totals, Round-off

**User Story:** As a billing operator, I want reproducible totals and a reconciling tax summary.

#### Acceptance Criteria

1. WHEN a line is calculated THEN the system SHALL compute gross = quantity × rate, discount amount = gross × discount%, and taxable = gross − discount, each quantized per the engine's defined points.
2. WHEN line tax is calculated THEN CGST/SGST each SHALL be taxable × (rate/2) intra-state, and IGST SHALL be taxable × rate inter-state.
3. WHEN the tax summary is produced THEN the system SHALL group by the composite key {HSN/SAC + tax treatment + applicable rate(s)} and SHALL reconcile exactly to line-level tax and invoice totals.
4. WHEN invoice totals are calculated THEN the system SHALL compute total taxable, total CGST, total SGST, total IGST, raw total, explicit round-off, and grand total.
5. WHEN round-off is calculated THEN round_off = rounded_total − raw_total (may be + or −) and grand_total = raw_total + round_off.
6. WHEN calculations run THEN exactly one calculation engine SHALL own them; the UI, persistence, and PDF SHALL consume its results and SHALL NOT recalculate (DECISIONS D-006).

### Requirement 8: Draft Lifecycle

**User Story:** As a billing operator, I want to save partial invoices as drafts, so that I can finish them later.

#### Acceptance Criteria

1. WHILE an invoice is DRAFT THEN the system SHALL allow saving incomplete data (e.g. missing lines, missing references) without enforcing finalization rules.
2. WHILE an invoice is DRAFT THEN the system SHALL allow editing all fields and deleting the draft (deleting cascades to its line items).
3. WHILE an invoice is DRAFT THEN the system SHALL NOT allocate a final invoice number and SHALL NOT establish a finalized financial identity.
4. WHEN a draft is saved THEN the system SHALL persist whatever valid partial data exists and surface non-blocking warnings for missing items rather than blocking the save.

### Requirement 9: Finalization (Strict, Atomic)

**User Story:** As a billing operator, I want finalization to guarantee a correct, permanent invoice.

#### Acceptance Criteria

1. WHEN the operator finalizes THEN the system SHALL validate, in order: company data, customer data, invoice date, each line item, quantity, rate, discount, HSN/SAC where required, and resolve Place of Supply / tax treatment — before allocating a number.
2. WHEN validation passes THEN the system SHALL calculate tax, totals, and round-off; allocate the invoice number safely (Req 10); prepare the historical snapshot (Req 12); pin the asset versions (Req 17) and template version (Req 18); and commit atomically.
3. IF any finalization step fails THEN the system SHALL roll back completely, leaving no partially finalized invoice and consuming no invoice number that becomes reusable.
4. WHEN finalization succeeds THEN the system SHALL set status FINALIZED and lock the number, dates, parties, line items, tax values, and totals.
5. WHEN an invoice is FINALIZED THEN the system SHALL NOT allow silent edits to any locked field.

### Requirement 10: Invoice Numbering

**User Story:** As a billing operator, I want unique, correct invoice numbers, so that numbering is never duplicated or reused.

#### Acceptance Criteria

1. WHEN a number is allocated THEN the system SHALL use a dedicated numbering sequence scoped by {numbering scope, financial year, prefix} and SHALL NOT use `MAX(invoice_number)`.
2. WHEN a number is allocated THEN the system SHALL do so within the finalization transaction and SHALL guarantee uniqueness.
3. WHEN a financial year rolls over (Indian FY, 1 Apr–31 Mar per OPEN_QUESTIONS Q-004) THEN the system SHALL start a new sequence for the new FY.
4. WHEN an invoice date is backdated into a prior FY THEN the system SHALL allocate from that FY's sequence (OPEN_QUESTIONS Q-012) and SHALL flag the case for confirmation.
5. WHEN a number is issued (i.e. the finalization transaction commits) THEN the system SHALL never reuse it; cancelling an invoice SHALL NOT release its number (DECISIONS D-027).
6. WHEN allocation fails (e.g. contention) THEN the system SHALL retry safely or fail without issuing a duplicate, and SHALL surface a clear error.
7. WHEN the numbering prefix is changed in settings THEN the system SHALL apply it to future allocations without altering already-issued numbers.
8. WHEN a number is issued THEN the system SHALL advance a persisted monotonic high-water mark per numbering scope, used for restore reconciliation (Req 15).
9. WHEN a finalization transaction rolls back after allocating a number THEN that number SHALL NOT be considered issued and MAY be allocated by a later successful transaction (DECISIONS D-027).
10. WHEN a number is allocated THEN the system SHALL do so using SQLite-compatible locking (`BEGIN IMMEDIATE` on the owning transaction), SHALL NOT use `SELECT ... FOR UPDATE`, and SHALL rely on the `UNIQUE` invoice-number constraint as the final backstop (DECISIONS D-028).

### Requirement 11: Place of Supply

**User Story:** As a billing operator, I want Place of Supply to be explicit, so that tax type is authoritative.

#### Acceptance Criteria

1. WHEN an invoice is created THEN the system SHALL expose Place of Supply (state + code) as an explicit field defaulting from the customer.
2. WHEN the operator overrides Place of Supply THEN the system SHALL use the overridden value for tax determination.
3. WHEN tax type is computed THEN the system SHALL use Place of Supply as the authoritative input (per Req 6.6).

### Requirement 12: Historical Finalized Snapshot

**User Story:** As a billing operator, I want finalized invoices to stay fixed, so that later master edits never change history.

#### Acceptance Criteria

1. WHEN an invoice is finalized THEN the system SHALL store an invoice-facing snapshot containing company details, customer details, bill-to and ship-to/consignee details, GSTIN, state/state code, invoice references, each line's description/job/mould/operation/specification/HSN-SAC/quantity/unit/rate/discount, tax rates and amounts, totals, payment terms, due date, notes, terms, declaration, and bank/UPI display info.
2. WHEN a customer or company master is edited later THEN the system SHALL NOT alter any finalized invoice's snapshot or its generated PDF content.
3. WHEN a finalized invoice is reproduced THEN the stored snapshot SHALL be the authoritative source; the system SHALL read only its snapshot (plus pinned asset/template versions) and SHALL NOT reconstruct content from live Company/Customer master tables (DECISIONS D-010).
4. WHEN reproduction occurs THEN SQLite SHALL be the source of truth; an exported PDF is not the record. Structured snapshot columns exist for search/listing/reporting only, not as the historical document authority.

### Requirement 13: Payment Status

**User Story:** As a billing operator, I want to record payment status separately from invoice status.

#### Acceptance Criteria

1. WHEN the operator sets payment status THEN the system SHALL support UNPAID, PARTIAL, PAID independent of DRAFT/FINALIZED/CANCELLED (e.g. FINALIZED + UNPAID is valid).
2. WHEN payment status changes THEN the system SHALL NOT change any financial calculation or the invoice number.
3. WHERE V1 is concerned THEN the system SHALL treat payment status as a display/local marker and SHALL NOT claim authoritative outstanding balances or implement a receipt ledger (DECISIONS D-015; PARTIAL amount tracking is OPEN_QUESTIONS Q-011).

### Requirement 14: Cancellation

**User Story:** As a billing operator, I want to cancel a finalized invoice without losing history.

#### Acceptance Criteria

1. WHEN a finalized invoice is cancelled THEN the system SHALL set status CANCELLED and record a cancellation timestamp and reason.
2. WHEN cancelled THEN the system SHALL preserve the original snapshot and invoice number and SHALL NOT release the number.
3. WHEN cancelled THEN the system SHALL NOT hard-delete the record.
4. WHERE a replacement invoice exists THEN the system MAY record a replacement relationship.
5. WHEN a cancelled invoice is viewed or reprinted THEN the system SHALL clearly indicate the cancelled state (watermark styling is OPEN_QUESTIONS Q-010).

### Requirement 15: Backup, Restore, and Numbering Reconciliation

**User Story:** As a billing operator, I want safe backups and restores that never corrupt data or reuse invoice numbers.

#### Acceptance Criteria

1. WHEN a backup is created THEN the system SHALL use SQLite's safe backup mechanism (consistent snapshot), never a raw file copy during writes.
2. WHEN a backup is created THEN the system SHALL produce a package containing the database, schema/app version, required invoice assets, and a manifest with integrity information.
3. WHEN a restore is requested THEN the system SHALL, before replacing current data, capture the current trusted numbering high-water state per scope, validate the backup, create a safety backup of current data, require confirmation, and restore atomically.
4. IF a restore fails THEN the system SHALL recover to the pre-restore state using the safety backup.
5. WHEN a restore completes THEN the system SHALL enter a reconciliation-pending state that blocks issuing new invoice numbers, and SHALL reconcile each numbering scope by advancing its effective sequence to at least `trusted_high_water_mark + 1` using the pre-restore captured state (NOT the restored backup's internal mark), so numbers issued after the backup are never reused (DECISIONS D-029; UX is OPEN_QUESTIONS Q-009).
6a. WHEN reconciliation runs THEN the captured pre-restore reconciliation metadata SHALL survive the database replacement long enough to complete reconciliation.
6. WHERE automatic backup is enabled THEN the system SHALL create backups per the configured policy (policy detail is OPEN_QUESTIONS Q-014).

### Requirement 16: Duplication

**User Story:** As a billing operator, I want to duplicate an invoice into a new draft, so that repeated jobs are fast.

#### Acceptance Criteria

1. WHEN the operator duplicates an invoice THEN the system SHALL create a new DRAFT containing only editable business content.
2. WHEN duplicating THEN the system SHALL NOT copy the original invoice id, finalized state, final invoice number, or payment status.
3. WHEN the duplicate is finalized THEN it SHALL receive a new invoice identity and number through the normal process.

### Requirement 17: Asset Versioning

**User Story:** As a billing operator, I want historical invoices to keep the exact logo/signature they were issued with.

#### Acceptance Criteria

1. WHEN a logo/signature/stamp is configured THEN the system SHALL store it as a versioned asset (content-addressed or versioned), not a mutable path (DECISIONS D-019).
2. WHEN an invoice is finalized THEN the system SHALL pin the exact asset version used.
3. WHEN a finalized invoice is reproduced THEN the system SHALL render the pinned asset version, not the current one.
4. WHEN a backup is created THEN it SHALL include the asset versions required to reproduce stored invoices.
5. IF a pinned asset is missing at render time THEN the system SHALL degrade gracefully with a non-fatal warning rather than crash.

### Requirement 18: Invoice Template Versioning

**User Story:** As a billing operator, I want visual redesigns to not rewrite my historical invoices.

#### Acceptance Criteria

1. WHEN an invoice is finalized THEN the system SHALL record an invoice template/layout version separate from its content snapshot (DECISIONS D-020).
2. WHEN a finalized invoice is reprinted THEN the system SHALL, by default, use the stored template version (auto-upgrade policy is OPEN_QUESTIONS Q-008).
3. WHEN the template changes THEN the system SHALL NOT redefine or reflow the content snapshot of historical invoices.

### Requirement 19: PDF Generation and Robustness

**User Story:** As a billing operator, I want a professional A4 PDF that renders correctly in all realistic cases.

#### Acceptance Criteria

1. WHEN a PDF is generated THEN the system SHALL produce A4 portrait output that is printer-friendly and readable in black-and-white.
2. WHEN a PDF is rendered THEN the system SHALL render sections in order: header/branding, invoice metadata, bill-to/ship-to, references/logistics, mould/machining line items, tax summary, totals, amount in words, payment/bank details, notes, terms, declaration, authorized signatory, footer/page number.
3. WHEN content is long (descriptions, names, addresses, many lines) THEN the system SHALL wrap and paginate rather than clip, repeat the line-item header on continued pages, avoid splitting a row where possible, keep totals and signature together, and show page numbers.
4. WHEN the invoice contains special characters (`&`, `<`, `>`, `₹`, `×`) THEN the system SHALL render them correctly.
5. WHEN logo, signature, or QR are missing THEN the system SHALL omit them gracefully without blank placeholders or errors.
6. WHEN optional fields are empty THEN the system SHALL omit their labels rather than printing empty rows such as `PO No:` with no value.
7. WHEN totals are rendered THEN the grand total SHALL be the most visually prominent monetary value.
8. WHEN the PDF is rendered THEN the renderer SHALL consume a prepared immutable render DTO, SHALL NOT query the database, and SHALL NOT recalculate tax/discount/totals/round-off (DECISIONS D-011).
9. WHEN forced to choose THEN the system SHALL NOT shrink fonts below a readable minimum merely to fit one page.

### Requirement 20: PDF Preview, Export, Print, Reprint

**User Story:** As a billing operator, I want to preview, export, print, and reprint the exact same document.

#### Acceptance Criteria

1. WHEN the operator previews THEN the system SHALL show the same document that will be exported/printed, from one rendering implementation.
2. WHEN exporting THEN the system SHALL use a deterministic default filename derived from the invoice number (e.g. `INV_SE_26-27_043.pdf`) and allow choosing the path.
3. WHEN printing THEN the system SHALL print the generated PDF via the OS printer through a platform-replaceable adapter, with no platform-specific code in the business layer.
4. WHEN a finalized invoice is reprinted or re-exported THEN the system SHALL use the stored snapshot, SHALL NOT create a new invoice, and SHALL reproduce identical invoice **content** (invoice UUID, number, date, company/customer snapshot, bill-to/ship-to, references, line items, quantities, rates, discounts, HSN/SAC, tax rates and amounts, totals, round-off, amount in words, terms, declaration, payment info, pinned asset versions, template version). It SHALL NOT be required to produce byte-for-byte identical PDF files (DECISIONS D-031).
5. IF export fails THEN the system SHALL NOT modify or corrupt the stored invoice.

### Requirement 21: Invoice History, Search, and Duplication Access

**User Story:** As a billing operator, I want to find, view, and reuse past invoices.

#### Acceptance Criteria

1. WHEN the operator opens history THEN the system SHALL list invoice number, date, customer, job/mould reference, total, invoice status, and payment status.
2. WHEN searching/filtering THEN the system SHALL support search by number, search by customer, date-range filter, status filter, and sorting.
3. WHEN listing THEN the system SHALL load summary data without loading every line item for every invoice.
4. WHEN selecting an invoice THEN the system SHALL support view, preview, print, export, duplicate (Req 16), and cancel (Req 14).
5. WHEN normal workflows are used THEN the system SHALL NOT permanently delete finalized or cancelled invoices.

### Requirement 22: Amount in Words

**User Story:** As a billing operator, I want totals spelled out automatically.

#### Acceptance Criteria

1. WHEN an invoice is calculated THEN the system SHALL generate the grand total in words (e.g. `INR Fourteen Thousand Four Hundred Ninety Only`).
2. WHEN an invoice is calculated THEN the system SHALL generate the total tax amount in words, including paise where present (e.g. `INR Two Thousand Two Hundred Ten and Forty Paise Only`).
3. WHEN words are generated THEN the system SHALL derive them from the final calculated values and SHALL NOT allow manual entry.

### Requirement 23: Local Persistence and Data Integrity

**User Story:** As a billing operator, I want reliable, consistent local storage.

#### Acceptance Criteria

1. WHEN data is stored THEN the system SHALL use a local SQLite database in the per-user application data directory, separate from the install directory.
2. WHEN the database is accessed THEN the system SHALL use parameterized queries only.
3. WHEN the schema is defined THEN the system SHALL enforce foreign-key integrity, a unique constraint on finalized invoice numbers, and CHECK constraints on invoice/payment status values.
4. WHEN the application starts THEN it SHALL resolve the app data directory, initialize SQLite, and apply pending migrations via a schema-version mechanism without overwriting an existing database on version change.
5. WHEN a draft is deleted THEN its line items SHALL be deleted; finalized/cancelled invoices SHALL NOT be hard-deleted through normal workflows.

### Requirement 24: Offline Operation

**User Story:** As a billing operator, I want the app to work with no internet.

#### Acceptance Criteria

1. WHEN the network is disconnected THEN the system SHALL still allow creating customers, creating/finalizing invoices, calculating GST, generating PDFs, previewing, printing, searching, backup, and restore.
2. WHEN any operation runs THEN the system SHALL make no runtime network call (no cloud, API, SaaS DB, remote auth, or GST verification).
3. WHEN GSTIN is validated THEN the system SHALL perform format-only validation.

### Requirement 25: UI, Usability, Errors, Logging

**User Story:** As a non-technical operator, I want clear screens, shortcuts, and understandable errors.

#### Acceptance Criteria

1. WHEN the application opens THEN the system SHALL provide Dashboard, Customers, Create/Edit Invoice, Invoice History, and Settings screens.
2. WHEN using the keyboard THEN the system SHALL support Ctrl+N/S/P/F, Escape, and Tab/Shift+Tab, minimizing mouse use during line-item entry.
3. WHEN a validation issue occurs THEN the system SHALL show it near the field and distinguish blocking errors (finalization) from non-blocking warnings (draft).
4. WHEN a database, save, duplicate-number, PDF, printer, path, permission, disk-full, backup, or restore error occurs THEN the system SHALL show a business-friendly message and SHALL NOT show a raw stack trace.
5. WHEN errors occur THEN the system SHALL write technical detail to a local log and SHALL NOT log passwords, credentials, or unnecessary PII.
6. WHEN UI code runs THEN it SHALL NOT contain SQL or GST/financial calculations; it SHALL delegate to services.
7. WHEN a long operation runs (large PDF, backup, restore) THEN the system SHALL avoid blocking the UI thread.

### Requirement 26: Windows Printing/Preview Proof (Early)

**User Story:** As the team, we want the Windows print/preview path proven early, so that late surprises are avoided.

#### Acceptance Criteria

1. WHEN foundation work is underway THEN the system SHALL include an early spike proving PDF generation, PDF preview/open on Windows, and printing to a Windows printer, before the production UI is built.
2. WHEN the spike completes THEN its approach SHALL be recorded (informing OPEN_QUESTIONS Q-015) and used by the PrintService adapter.

### Requirement 27: Packaging and Data Separation

**User Story:** As a billing operator, I want to install/upgrade without losing data.

#### Acceptance Criteria

1. WHEN the application is packaged THEN it SHALL be distributable as a Windows executable bundling the runtime and dependencies.
2. WHEN installed or upgraded THEN user data (database, backups, exports, assets, logs) SHALL reside in the user data directory, separate from the install directory, so upgrades preserve invoices.

### Requirement 28: Golden Invoice Regression Fixtures

**User Story:** As a developer, I want the two real invoices reproduced exactly.

#### Acceptance Criteria

1. WHEN Invoice 043 is calculated THEN the system SHALL produce taxable ₹12,280.00, CGST ₹1,105.20, SGST ₹1,105.20, round-off −₹0.40, grand total ₹14,490.00.
2. WHEN Invoice 089 is calculated THEN the system SHALL produce taxable ₹8,332.00, CGST ₹749.88, SGST ₹749.88, round-off +₹0.24, grand total ₹9,832.00.
3. WHEN these fixtures are used THEN they SHALL be treated as **aggregate** fixtures; the system SHALL NOT fabricate missing per-line source values, and any complete line-level fixture SHALL be labeled pending source data (OPEN_QUESTIONS Q-013).
4. WHEN the suite runs THEN both fixtures SHALL be covered by calculation and PDF value checks.

### Requirement 29: Reusable Service Templates (Optional / P2)

**User Story:** As a billing operator, I want reusable service descriptions, so that common operations are faster.

#### Acceptance Criteria

1. WHERE service templates are enabled THEN the system SHALL let the operator save and insert reusable service descriptions (e.g. Gundrilling, 6 Side Machining).
2. WHEN a template is inserted THEN the resulting line item SHALL remain freely editable.
3. WHEN implemented THEN the system SHALL NOT build inventory or product-management features.

### Requirement 30: Entity Identity (UUID)

**User Story:** As the system, I want stable internal identities separate from business numbers, so that references stay valid across edits, backups, and restores.

#### Acceptance Criteria

1. WHEN any persistent entity is created (Company, Customer, Invoice, InvoiceLine, Asset, ServiceTemplate, and future entities) THEN the system SHALL assign it a UUID4 generated by the application/domain layer, not by SQLite AUTOINCREMENT (DECISIONS D-023).
2. WHEN an entity id is stored THEN the system SHALL persist it as canonical lowercase hyphenated TEXT and validate its format at the repository boundary (DECISIONS D-024).
3. WHEN an entity id exists THEN it SHALL be immutable, not user-editable, and never reused even after deletion; foreign keys SHALL reference these UUIDs.
4. WHEN an ordinary update occurs THEN the system SHALL NOT regenerate the entity's id.
5. WHEN an invoice is duplicated THEN the new draft SHALL receive a new UUID and no copied finalized invoice number; WHEN an invoice is cancelled or finalized THEN it SHALL keep the same UUID.
6. WHEN a backup is restored THEN all entity UUIDs and their foreign-key relationships SHALL be preserved unchanged.
7. WHEN the operator uses normal screens THEN the system SHALL NOT display UUIDs except for diagnostics; logs MAY include UUIDs.
8. WHEN deterministic tests are needed THEN the system SHALL allow injecting an id generator (or a test UUID factory) rather than requiring monkeypatching of the uuid module (DECISIONS D-023).
9. WHEN the invoice UUID and invoice number are referenced THEN the system SHALL keep them distinct and SHALL NOT treat the UUID as the invoice number (DECISIONS D-025).
