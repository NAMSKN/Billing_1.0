# Requirements Document

## Introduction

This document defines the requirements for a **local desktop billing application** for a mould / mould-machining business in India. The application enables a small-business operator to maintain company and customer information, create GST tax invoices with mould/machining line items, calculate taxes and totals deterministically, generate professional A4 PDF invoices, print them locally, and manage invoice history with backup and restore.

The application is 100% local and offline: it has no cloud, server, REST API, or internet runtime dependency. It is a billing tool, not an ERP, CRM, or accounting suite.

The runtime stack is Python + PySide6 (UI) + SQLite (persistence) + ReportLab (PDF), with `Decimal` used for all money. The two real sample invoices (SE/26-27/043 and SE/26-27/089) are golden regression fixtures whose calculated values must be reproduced exactly.

Source documents: `docs/PRODUCT_REQUIREMENTS.md`, `docs/INVOICE_RULES.md`, `docs/ARCHITECTURE.md`, `docs/PDF_LAYOUT.md`.

---

## Requirements

### Requirement 1: Company / Supplier Master

**User Story:** As a billing operator, I want to configure my company details once, so that every invoice carries accurate supplier and bank information.

#### Acceptance Criteria

1. WHEN the operator opens Settings THEN the system SHALL allow entry of company name, full address, GSTIN/UIN, state name, state code, email, and phone.
2. WHEN the operator saves company settings THEN the system SHALL support bank name, account number, branch name, and IFSC code.
3. WHEN the operator saves company settings THEN the system SHALL support a logo image, an authorized signatory name, and an optional signature/stamp image, stored as local file paths.
4. WHEN the operator saves company settings with an empty company name THEN the system SHALL block the save and display a validation message near the field.
5. WHEN a GSTIN, email, or IFSC value is entered THEN the system SHALL validate its format and report format errors without requiring internet access.
6. IF a logo or signature file path no longer exists at render time THEN the system SHALL degrade gracefully and surface a non-fatal warning rather than crash.

### Requirement 2: Customer Master

**User Story:** As a billing operator, I want to save customers once and reuse them, so that I do not retype details for every invoice.

#### Acceptance Criteria

1. WHEN the operator creates a customer THEN the system SHALL require a customer name, billing address, and state information.
2. WHEN the operator creates a customer THEN the system SHALL support GSTIN/UIN, state name, state code, phone, and email as optional fields.
3. WHEN a GSTIN or email is entered for a customer THEN the system SHALL validate its format and reject invalid values with a field-level message.
4. WHEN the operator enters shipping details THEN the system SHALL support a ship-to/consignee address, ship-to state, and an optional godown/warehouse address distinct from the billing address.
5. WHEN the ship-to address is identical to the bill-to address THEN the system SHALL still preserve both as distinct concepts.
6. WHEN the operator selects an existing customer while creating an invoice THEN the system SHALL auto-populate name, GSTIN, billing address, shipping/consignee information, state, and state code into the draft.
7. WHEN a customer is no longer active THEN the system SHALL mark it inactive (is_active = false) rather than hard-deleting it, exclude it from default new-invoice selection, and keep it available for viewing historical invoices.

### Requirement 3: Invoice Creation and Header

**User Story:** As a billing operator, I want to create an invoice with all required and optional header fields, so that it matches real-world tax invoice needs.

#### Acceptance Criteria

1. WHEN the operator creates a new invoice THEN the system SHALL require an invoice number, invoice date, a selected customer, and at least one line item before finalization.
2. WHEN a new invoice is created THEN the system SHALL default the invoice date to the current local date.
3. WHEN the operator edits invoice references THEN the system SHALL support delivery note number/date, reference number/date, buyer's order/PO number and date, dispatch document number/date, bill of lading / LR-RR number, motor vehicle number, dispatched-through, destination, terms of delivery, and other references, all optional.
4. WHEN the operator edits commercial fields THEN the system SHALL support payment terms, due date, and place of supply.
5. IF a due date is supplied THEN the system SHALL reject a due date earlier than the invoice date.
6. WHEN optional reference fields are empty THEN the system SHALL omit them from the PDF rather than printing empty labels.

### Requirement 4: Invoice Numbering

**User Story:** As a billing operator, I want invoice numbers generated automatically and uniquely, so that numbering is correct and never duplicated.

#### Acceptance Criteria

1. WHEN the system generates an invoice number THEN it SHALL follow a configurable pattern of PREFIX / FINANCIAL_YEAR / SEQUENCE (e.g. `SE/26-27/043`) with configurable prefix and financial-year component.
2. WHEN the next number is generated THEN the system SHALL derive the sequence from a dedicated local sequence store (invoice_sequences), not from `MAX(invoice_number)`.
3. WHEN an invoice number is reserved THEN the system SHALL perform the reservation inside a database transaction to prevent duplicate numbers.
4. WHEN an invoice is finalized THEN the system SHALL lock its number and SHALL NOT reuse a finalized number.
5. WHEN an invoice is cancelled THEN the system SHALL NOT free or reuse its invoice number.
6. WHEN an invoice is duplicated THEN the system SHALL assign the duplicate its own new number rather than reusing the original's.

### Requirement 5: Mould / Machining Line Items

**User Story:** As a billing operator, I want structured mould/machining fields plus free text, so that technical job details stay clear rather than being crammed into one description.

#### Acceptance Criteria

1. WHEN the operator adds a line item THEN the system SHALL support job/mould reference, component/part, operation/process, description, specification, HSN/SAC, quantity, unit, rate, and discount percent.
2. WHEN the operator adds a line item THEN the system SHALL always keep a free-text description available even when structured fields are used.
3. WHEN the operator adds line items THEN the system SHALL support multiple line items on one invoice, each with its own rate and calculated taxable amount.
4. WHEN the operator selects a unit THEN the system SHALL allow arbitrary units (e.g. NOS, MM, PCS, KG, SET, HOURS) selectable per line item, without hardcoding a single unit.
5. WHEN a line item is saved THEN the system SHALL require a non-empty description, require HSN/SAC for a taxable service line, require quantity greater than zero, reject a negative rate, and require discount percent between 0 and 100.
6. WHEN a serial number is needed THEN the system SHALL assign it automatically.

### Requirement 6: HSN/SAC Handling

**User Story:** As a billing operator, I want configurable HSN/SAC codes, so that I can bill different services correctly.

#### Acceptance Criteria

1. WHEN a taxable line item is entered THEN the system SHALL require an HSN/SAC code.
2. WHERE a default HSN/SAC is configured (e.g. `998898`) THEN the system SHALL prefill it but allow the operator to change it per line.
3. WHEN an invoice contains multiple HSN/SAC codes THEN the system SHALL support them and group the tax summary by HSN/SAC and applicable tax treatment.

### Requirement 7: Deterministic Monetary Calculation

**User Story:** As a billing operator, I want exact, reproducible money calculations, so that invoice totals are always correct.

#### Acceptance Criteria

1. WHEN any monetary value is calculated THEN the system SHALL use exact decimal arithmetic (Python `Decimal`) and SHALL NOT use binary floating-point for money.
2. WHEN a line item is calculated THEN the system SHALL compute Gross Amount = Quantity × Rate, Discount Amount = Gross Amount × Discount%, and Taxable Amount = Gross Amount − Discount Amount.
3. WHEN monetary values are presented THEN the system SHALL represent amounts to two decimal places.
4. WHEN invoice totals are calculated THEN the system SHALL compute line base amount, discount, taxable amount, applicable GST, total tax, pre-round total, explicit round-off, and grand total.
5. WHEN the round-off is calculated THEN the system SHALL compute round_off = rounded_total − raw_total, allow it to be positive or negative, and ensure grand total = raw_total + round_off.
6. WHERE there is exactly one authoritative calculation model THEN the UI, PDF renderer, and persistence layer SHALL consume its results and SHALL NOT independently recalculate tax, discount, totals, or round-off.

### Requirement 8: GST Determination and Tax Summary

**User Story:** As a billing operator, I want the correct GST type applied automatically, so that intra-state and inter-state invoices are taxed properly.

#### Acceptance Criteria

1. WHEN supplier state and place of supply / customer state are the same THEN the system SHALL apply CGST + SGST (intra-state).
2. WHEN supplier state and place of supply / customer state differ THEN the system SHALL apply IGST (inter-state).
3. WHEN calculating tax for a line THEN the system SHALL populate only the applicable components and SHALL NOT apply CGST+SGST and IGST simultaneously to a single normal supply line.
4. WHEN tax rates are used THEN the system SHALL treat them as configurable (with a configurable default) and SHALL NOT hardcode 9%+9% or 18%.
5. WHEN the tax summary is produced THEN the system SHALL group lines by HSN/SAC and report taxable value, CGST rate/amount, SGST rate/amount, IGST rate/amount (when applicable), and total tax, reconciling exactly with invoice totals.

### Requirement 9: Amount in Words

**User Story:** As a billing operator, I want totals spelled out in words automatically, so that invoices are legally clear.

#### Acceptance Criteria

1. WHEN an invoice is calculated THEN the system SHALL generate the grand total in words (e.g. `INR Fourteen Thousand Four Hundred Ninety Only`).
2. WHEN an invoice is calculated THEN the system SHALL generate the total tax amount in words, including paise where present (e.g. `INR Two Thousand Two Hundred Ten and Forty Paise Only`).
3. WHEN amounts in words are generated THEN the system SHALL derive them from the final calculated decimal values and SHALL NOT allow manual entry.

### Requirement 10: Invoice Lifecycle (Draft / Finalized / Cancelled)

**User Story:** As a billing operator, I want a controlled invoice lifecycle, so that finalized invoices remain stable and history is preserved.

#### Acceptance Criteria

1. WHILE an invoice is in Draft THEN the system SHALL allow editing, repeated saving, and deletion, and SHALL permit incomplete data.
2. WHEN the operator finalizes an invoice THEN the system SHALL validate company, customer, invoice date, line items, HSN/SAC, quantity/rate/discount, and tax configuration before finalizing.
3. WHEN finalization succeeds THEN the system SHALL lock the invoice number and financial values, set status to FINALIZED, and preserve an invoice-facing snapshot of company and customer details.
4. WHEN an invoice is FINALIZED THEN the system SHALL NOT silently change its number, date, customer, line-item amounts, tax values, or grand total.
5. WHEN a correction is needed on a finalized invoice THEN the system SHALL support cancellation plus a new invoice rather than in-place rewriting.
6. WHEN an invoice is cancelled THEN the system SHALL set status to CANCELLED, preserve the record and its number, and clearly identify the cancelled state; it SHALL NOT delete the underlying data.
7. WHEN finalization is performed THEN the system SHALL do so atomically within a single transaction and SHALL roll back completely on any failure, leaving no partially finalized invoice.

### Requirement 11: Payment Status and Payment Details

**User Story:** As a billing operator, I want to record payment status and show payment details, so that the invoice communicates how to pay without processing payments online.

#### Acceptance Criteria

1. WHEN the operator sets payment status THEN the system SHALL support UNPAID, PARTIAL, and PAID as values independent of invoice status.
2. WHEN payment status changes THEN the system SHALL NOT change any financial calculation or the invoice number.
3. WHEN payment details are configured THEN the system SHALL support payment terms, due date, bank details, UPI ID, and an optional UPI QR code.
4. WHERE a UPI QR is configured THEN the system SHALL render it on the invoice; otherwise it SHALL omit the QR without a blank placeholder.
5. WHEN the application runs THEN it SHALL NOT process online payments.

### Requirement 12: Notes, Terms, and Declaration

**User Story:** As a billing operator, I want configurable notes, terms, and a declaration, so that invoices carry the right supplementary text.

#### Acceptance Criteria

1. WHEN the operator edits an invoice THEN the system SHALL support an optional invoice-level Notes field.
2. WHEN default Terms & Conditions are configured THEN the system SHALL load them into a new draft and allow invoice-level customization.
3. WHEN an invoice is finalized THEN the system SHALL capture the notes, terms, and declaration into the invoice snapshot so later default changes do not alter historical invoices.
4. WHERE the declaration is enabled (default on) THEN the system SHALL render the configured declaration text in the invoice footer.

### Requirement 13: PDF Invoice Generation

**User Story:** As a billing operator, I want a professional A4 PDF, so that I can print or share a clear, correct invoice.

#### Acceptance Criteria

1. WHEN the operator generates a PDF THEN the system SHALL produce an A4 portrait document that is printer-friendly and readable in black-and-white.
2. WHEN the PDF is rendered THEN the system SHALL render sections in order: header/branding, invoice metadata, bill-to/ship-to, references/logistics, mould/machining line items, tax summary, totals, amount in words, payment/bank details, notes, terms, declaration, authorized signatory, and footer/page number.
3. WHEN the line-item table is rendered THEN the system SHALL present structured technical data (job/mould, operation, description/specification, HSN/SAC, qty, unit, rate, discount, amount) without clipping technical text.
4. WHEN totals are rendered THEN the system SHALL make the grand total the most visually prominent monetary value.
5. WHEN the PDF is rendered THEN the renderer SHALL consume already-calculated invoice data and SHALL NOT perform accounting calculations or query the database for arbitrary fields.
6. WHEN an invoice has many line items THEN the system SHALL continue onto additional pages, repeat the line-item header, avoid splitting rows where possible, keep totals/signature together, and show page numbers.
7. WHEN optional fields are empty THEN the system SHALL omit them rather than printing awkward empty blocks.

### Requirement 14: PDF Preview, Export, and Printing

**User Story:** As a billing operator, I want to preview, export, print, and reprint invoices, so that I get the exact same document every time.

#### Acceptance Criteria

1. WHEN the operator previews an invoice THEN the system SHALL show the same document that will be printed/exported, using a single rendering implementation.
2. WHEN the operator exports a PDF THEN the system SHALL allow choosing an output location and SHALL use a deterministic default filename derived from the invoice number (e.g. `INV_SE_26-27_043.pdf`).
3. WHEN the operator prints THEN the system SHALL print the generated PDF via the OS printer through a platform-replaceable print adapter, keeping platform-specific code out of the business layer.
4. WHEN a finalized invoice is reprinted or re-exported THEN the system SHALL use the stored invoice data, SHALL NOT create a new invoice, and SHALL produce identical content unless only a visual/template configuration intentionally changed.
5. IF PDF export fails THEN the system SHALL NOT corrupt or modify the stored invoice.

### Requirement 15: Invoice History, Search, and Duplication

**User Story:** As a billing operator, I want to find, view, and reuse past invoices, so that repeated jobs are fast and history is accessible.

#### Acceptance Criteria

1. WHEN the operator opens invoice history THEN the system SHALL list invoice number, date, customer, job/mould reference, total amount, invoice status, and payment status.
2. WHEN the operator searches or filters THEN the system SHALL support search by invoice number, search by customer, date-range filter, status filter, and sorting.
3. WHEN listing invoices THEN the system SHALL load summary data without loading every line item for every invoice.
4. WHEN the operator selects an invoice THEN the system SHALL support view, preview, print, export PDF, and duplicate-as-new-draft.
5. WHEN an invoice is duplicated THEN the system SHALL copy editable business data into a new draft, exclude the original id/finalized status/number, and assign a new identity.
6. WHEN normal user workflows are used THEN the system SHALL NOT permanently delete finalized or cancelled invoices.

### Requirement 16: Historical Snapshot Integrity

**User Story:** As a billing operator, I want finalized invoices to stay fixed, so that editing masters later never changes past invoices.

#### Acceptance Criteria

1. WHEN an invoice is finalized THEN the system SHALL store an invoice-facing snapshot of company details, customer details, bill-to/ship-to addresses, GSTIN, state, line-item descriptions, mould/job info, HSN/SAC, quantity, unit, rate, discount, tax rates, calculated taxes, totals, notes, terms, and declaration.
2. WHEN a customer or company master is later edited THEN the system SHALL NOT alter any finalized invoice's stored values or generated PDF content.
3. WHEN a finalized invoice PDF is reproduced THEN the system SHALL reproduce it entirely from stored invoice data, with SQLite as the source of truth (the exported PDF is not the record).

### Requirement 17: Local Persistence and Data Integrity

**User Story:** As a billing operator, I want reliable local storage, so that my data is safe and consistent.

#### Acceptance Criteria

1. WHEN the application stores data THEN it SHALL use a local SQLite database in a platform-appropriate user data directory, keeping user data separate from the install directory.
2. WHEN the database is accessed THEN the system SHALL use parameterized queries and SHALL NOT execute user input as SQL.
3. WHEN the database schema is defined THEN the system SHALL enforce foreign-key integrity, unique invoice numbers, valid invoice/payment status values, and valid line-item references.
4. WHEN the application starts THEN it SHALL resolve the app data directory, initialize SQLite, apply pending schema migrations using a schema-version mechanism, and SHALL NOT overwrite an existing database merely due to a version change.
5. WHEN a draft invoice is intentionally deleted THEN the system SHALL delete its line items; finalized invoices SHALL NOT be hard-deleted through normal workflows.

### Requirement 18: Backup and Restore

**User Story:** As a billing operator, I want to back up and restore my data, so that I never lose billing history.

#### Acceptance Criteria

1. WHEN the operator requests a backup THEN the system SHALL create a timestamped local backup of the SQLite database and support retaining multiple versions in a clear backup location.
2. WHERE automatic backup is enabled THEN the system SHALL create local backups automatically per the configured policy.
3. WHEN the operator requests a restore THEN the system SHALL validate the selected backup, create a safety backup of the current database, require confirmation, and SHALL NOT silently overwrite the existing database.
4. WHEN a restore completes THEN the system SHALL reload/restart the application against the restored database.

### Requirement 19: Offline Operation

**User Story:** As a billing operator, I want the app to work without internet, so that billing is never blocked by connectivity.

#### Acceptance Criteria

1. WHEN the network is disconnected THEN the system SHALL still allow creating customers, creating invoices, calculating GST, finalizing invoices, generating PDFs, printing, searching history, backup, and restore.
2. WHEN any operation runs THEN the system SHALL NOT require any runtime call to AWS, Google Cloud, Azure, a REST API, a SaaS database, remote authentication, or remote GST validation.
3. WHEN GSTIN is validated THEN the system SHALL perform format validation only, with no live verification.

### Requirement 20: Desktop UI, Usability, and Error Handling

**User Story:** As a billing operator, I want clear screens, keyboard shortcuts, and understandable errors, so that I can bill quickly without technical knowledge.

#### Acceptance Criteria

1. WHEN the application opens THEN the system SHALL provide Dashboard, Customers, Create/Edit Invoice, Invoice History, and Settings screens.
2. WHEN the operator uses the keyboard THEN the system SHALL support Ctrl+N (new invoice), Ctrl+S (save), Ctrl+P (print), Ctrl+F (search), Escape (cancel/close), and Tab/Shift+Tab navigation, minimizing mouse use during line-item entry.
3. WHEN a validation error occurs THEN the system SHALL show it near the relevant field and SHALL distinguish blocking errors from non-blocking warnings.
4. WHEN a database, save, duplicate-number, PDF, printer, file-path, permission, disk-full, backup, or restore error occurs THEN the system SHALL show a business-friendly message and SHALL NOT expose raw stack traces in normal UI.
5. WHEN errors occur THEN the system SHALL write technical detail to a local log file and SHALL NOT log passwords, credentials, or unnecessary personal data.
6. WHEN UI code runs THEN it SHALL NOT contain GST/financial formulas or execute SQL directly; it SHALL delegate to application services.
7. WHEN a long-running operation (large PDF, backup, restore) runs THEN the system SHALL avoid blocking the UI thread.

### Requirement 21: Golden Invoice Regression Fixtures

**User Story:** As a developer, I want the two real invoices reproduced exactly, so that the calculation engine and PDF output are provably correct.

#### Acceptance Criteria

1. WHEN Invoice 043 (DI-TECH MOULDS, `SE/26-27/043`) is calculated THEN the system SHALL produce taxable value ₹12,280.00, CGST ₹1,105.20, SGST ₹1,105.20, round-off −₹0.40, and grand total ₹14,490.00.
2. WHEN Invoice 089 (BMSS STEEL INDUSTRIES PRIVATE LIMITED, `SE/26-27/089`) is calculated THEN the system SHALL produce taxable value ₹8,332.00, CGST ₹749.88, SGST ₹749.88, round-off ₹0.24, and grand total ₹9,832.00.
3. WHEN the test suite runs THEN both invoices SHALL exist as automated regression fixtures covering calculation and PDF value checks.
4. WHEN Invoice 043 is represented THEN the system SHALL be capable of storing job DT-663, operation Punch Gun Drilling, specification DRILL DIA 9X307MM DEEP, quantity 16 NOS., and HSN/SAC 998898.
5. WHEN Invoice 089 is represented THEN the system SHALL be capable of storing two machining lines (6 SIDE MACHINING 510X430X130 and 510X430X150), PO BMSS/L/070/26-27, challan CHALLAN NO. 353, vehicle MH48CQ5748, and payment terms 30 Days.

### Requirement 22: Reusable Service Templates (Optional / P2)

**User Story:** As a billing operator, I want lightweight reusable service descriptions, so that common operations are faster to enter.

#### Acceptance Criteria

1. WHERE service templates are enabled THEN the system SHALL let the operator save reusable service descriptions (e.g. Gundrilling, 6 Side Machining) and insert them into a line item.
2. WHEN a template is inserted THEN the system SHALL allow the operator to edit the resulting line item freely.
3. WHEN service templates are implemented THEN the system SHALL NOT build a full inventory or product-management module.

### Requirement 23: Packaging and Data Separation

**User Story:** As a billing operator, I want to install and upgrade the app without losing data, so that updates are safe.

#### Acceptance Criteria

1. WHEN the application is packaged THEN the system SHALL be distributable as a desktop executable (Windows as the first target) bundling the Python runtime, PySide6, ReportLab, and SQLite dependencies plus application assets.
2. WHEN the application is installed or upgraded THEN user data (database, backups, exports, assets, logs) SHALL reside in the user data directory, separate from the install directory, so upgrades do not destroy invoices.
