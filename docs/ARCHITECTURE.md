ARCHITECTURE
Local Desktop Billing Application for Mould / Mould-Machining Business
Document Version: 2.0  
Status: Revised Architecture Baseline  
Related Documents:
`PRODUCT_REQUIREMENTS.md`
`feature/invoice-generator/INVOICE_RULES.md`
`feature/invoice-generator/PDF_LAYOUT.md`
`.kiro/specs/invoice-generator/requirements.md`
`.kiro/specs/invoice-generator/design.md`
`.kiro/specs/invoice-generator/tasks.md`
---
1. Purpose
This document defines the technical architecture for a single-computer, offline desktop billing application used by a mould / mould-machining business.
The application is responsible for:
```text
Enter Invoice
     ↓
Validate
     ↓
Calculate
     ↓
Finalize
     ↓
Store Locally
     ↓
Generate PDF
     ↓
Preview / Print / Export
```
The architecture is designed around five priorities:
Correct financial calculations.
Safe invoice history.
Reliable local persistence and recovery.
Professional and deterministic PDF generation.
Simple desktop operation without cloud infrastructure.
The architecture intentionally avoids distributed-system complexity.
---
2. Scope Boundary
2.1 In Scope
Company configuration
Customer management
Draft invoices
Finalized invoices
Invoice cancellation
Invoice duplication
Invoice numbering
Mould/job/machining details
GST calculations
Tax summaries
PDF generation
PDF preview
Local printing
PDF export
Payment-status tracking
Local backup and restore
Invoice search/history
2.2 Out of Scope
Do not introduce:
Cloud services
Backend server
REST API
Remote database
Cloud synchronization
SaaS infrastructure
Microservices
Redis
Kafka
Message queues
Online payment gateway
Online GSTIN verification
CRM
Payroll
Full accounting system
Full inventory system
Manufacturing planning system
Customer portal
Mobile application
---
3. Kiro Boundary
Kiro is the development environment and AI-assisted engineering tool used to build the project.
Kiro is not the runtime framework of the billing application.
The actual application runtime is:
```text
Python
  +
PySide6
  +
SQLite
  +
ReportLab
```
Kiro is used for:
```text
Requirements
    ↓
Specification
    ↓
Design
    ↓
Tasks
    ↓
Implementation
    ↓
Review
```
The `.kiro/` directory contains development guidance and specifications. It must not become a runtime dependency.
---
4. High-Level Architecture
```text
┌────────────────────────────────────────────────────────────┐
│                    DESKTOP APPLICATION                     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  Presentation Layer                  │  │
│  │                    PySide6 UI                        │  │
│  │                                                      │  │
│  │ Dashboard | Customers | Invoice | History | Settings│  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│                             ▼                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  Application Layer                   │  │
│  │                                                      │  │
│  │ InvoiceService                                      │  │
│  │ CustomerService                                     │  │
│  │ CompanyService                                      │  │
│  │ CalculationService                                  │  │
│  │ PDFService                                           │  │
│  │ BackupService                                        │  │
│  │ PrintService                                         │  │
│  │ SettingsService                                     │  │
│  └──────────────┬──────────────────────┬────────────────┘  │
│                 │                      │                   │
│                 ▼                      ▼                   │
│  ┌────────────────────────┐   ┌─────────────────────────┐ │
│  │ Domain Layer           │   │ Infrastructure Layer   │ │
│  │                        │   │                         │ │
│  │ Invoice rules          │   │ SQLite repositories     │ │
│  │ Draft/final rules      │   │ File storage            │ │
│  │ GST rules              │   │ PDF renderer             │ │
│  │ Money rules            │   │ Printer adapter          │ │
│  │ Numbering rules        │   │ Backup/restore           │ │
│  │ Status rules           │   │ Asset management         │ │
│  └────────────────────────┘   └─────────────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │       LOCAL DISK       │
                  │                        │
                  │ SQLite                 │
                  │ PDF exports            │
                  │ Backups                │
                  │ Versioned assets       │
                  │ Logs                   │
                  └────────────────────────┘
```
---
5. Architectural Style
Use a lightweight layered architecture with explicit domain rules and repository interfaces.
```text
Presentation
     ↓
Application Services
     ↓
Domain / Business Rules
     ↓
Repository Interfaces
     ↓
Infrastructure Implementations
     ↓
SQLite / Files / OS
```
The dependency direction must remain inward:
```text
UI
 ↓
Application
 ↓
Domain

Infrastructure → implements domain/application interfaces
```
The domain must not depend on PySide6, SQLite, ReportLab, or OS-specific APIs.
---
6. Main Architectural Rule
The UI is an adapter, not the business layer.
Correct
```text
InvoiceForm
    ↓
InvoiceService
    ↓
CalculationService
    ↓
Domain rules
```
Incorrect
```text
InvoiceForm
 ├── SQL
 ├── GST formulas
 ├── rounding
 ├── invoice numbering
 ├── PDF drawing
 └── printer calls
```
The following are explicitly forbidden in UI classes:
Raw SQL
Financial calculations
Invoice-number generation
PDF layout logic
Database transaction management
OS-specific printer logic
---
7. Runtime Technology
Concern	Technology
Language	Python
Desktop UI	PySide6
Local database	SQLite
Validation	Pydantic where useful
PDF	ReportLab
QR	qrcode
Image handling	Pillow
Amount-to-words	num2words
Money arithmetic	Decimal
Tests	pytest
Lint	Ruff
Type checking	mypy
Packaging	PyInstaller or equivalent
Dependencies must be added only when they support a real requirement.
Do not add infrastructure for hypothetical future needs.
---
8. Domain Layer
Location:
```text
src/domain/
```
The domain layer contains concepts and rules that are independent of the desktop framework and database.
Recommended structure:
```text
src/domain/
├── models/
│   ├── company.py
│   ├── customer.py
│   ├── invoice.py
│   ├── invoice_line.py
│   ├── invoice_totals.py
│   └── tax_summary.py
│
├── enums/
│   ├── invoice_status.py
│   ├── payment_status.py
│   └── tax_type.py
│
├── rules/
│   ├── calculations.py
│   ├── tax_rules.py
│   ├── numbering_rules.py
│   ├── validation_rules.py
│   └── invoice_lifecycle.py
│
└── repositories/
    ├── company_repository.py
    ├── customer_repository.py
    ├── invoice_repository.py
    └── sequence_repository.py
```
---
9. Draft and Finalized Models
Do not use one strict model for every invoice state.
The product allows incomplete drafts, while finalization requires complete and valid billing data.
Use separate contracts/states conceptually:
```text
InvoiceDraft
    ↓
FinalizeRequest / FinalizationValidation
    ↓
FinalizedInvoice
```
9.1 Draft
A draft may contain:
Missing customer
Incomplete line items
Missing optional references
Temporary/incomplete numeric input
A draft must still preserve valid entered information.
Malformed numeric values must not silently become zero.
9.2 Finalization
Finalization validates:
Company
Customer
Invoice date
Place of supply
Line items
HSN/SAC
Quantity
Rate
Discount
Tax configuration
Invoice references required by the supported scope
Only after validation succeeds may the invoice be finalized.
---
10. Invoice Lifecycle
Use explicit states:
```text
DRAFT
  │
  ▼
FINALIZED
  │
  └──────────► CANCELLED
```
Payment state is independent:
```text
UNPAID
PARTIAL
PAID
```
A payment-status change must never modify the financial content of a finalized invoice.
---
11. Finalized Invoice Immutability
After finalization, the following are immutable:
Invoice number
Invoice date
Company snapshot
Customer snapshot
Bill-to information
Ship-to information
Place of supply
References
Line items
Tax rates
Calculated taxes
Tax summary
Round-off
Grand total
Terms
Notes
Declaration
Payment information printed on the invoice
Template version reference
Asset version references
Allowed operations include:
View
Reprint
Export
Change payment status
Cancel
Create a duplicate/new draft
A finalized invoice must not be silently rewritten.
---
12. Historical Snapshot Architecture
Master data changes must not alter historical invoices.
The finalized invoice therefore stores an invoice-facing snapshot.
Example:
```text
Customer Master
    │
    │ current data
    ▼
Invoice Draft
    │
    │ snapshot at finalization
    ▼
Finalized Invoice
```
The snapshot must preserve:
Company
Name
Address
GSTIN
State
Email
Phone
Bank details
UPI details
Declaration settings
Customer
Name
GSTIN
Billing address
Shipping/consignee address
State
Contact information
Invoice
References
Payment terms
Due date
Place of supply
Notes
Terms
Declaration
Lines
Job/mould reference
Component/part
Operation
Description
Specification
HSN/SAC
Quantity
Unit
Rate
Discount
Tax rates
Calculated tax
---
13. Template Versioning
Historical financial content and visual template version are separate concepts.
Every finalized invoice should reference:
```text
template_version
```
Example:
```text
Invoice 043 → Template V1
Invoice 150 → Template V2
```
A template change may alter presentation, but must not alter stored financial or party data.
Whether an old invoice is re-rendered using its original template or an explicit "current template" action is a product decision that must be documented before implementation.
---
14. Asset Versioning
Do not rely only on mutable paths such as:
```text
assets/logo.png
```
because replacing that file can change the appearance of an old invoice.
Use immutable/versioned assets:
```text
assets/
├── logos/
│   ├── logo-v1.png
│   └── logo-v2.png
│
└── signatures/
    ├── signature-v1.png
    └── signature-v2.png
```
The finalized invoice stores asset references.
Backups must include the assets required by finalized invoices.
---
15. Money Architecture
All financial calculations must use:
```text
Decimal
```
Never use `float` on a monetary path.
Applies to:
Rate
Discount amount
Taxable value
CGST
SGST
IGST
Round-off
Grand total
Payment amount
The UI must parse decimal input directly from text into Decimal.
Do not use:
```text
float(user_input)
```
before converting to Decimal.
Reject:
NaN
Infinity
negative values where prohibited
---
16. Numeric Storage Policy
The application must define exact serialization before database implementation.
Recommended policy:
Money
Store as integer paise where practical.
Example:
```text
₹123.45 → 12345
```
Quantity
Store as canonical decimal text or another exact representation because quantity precision may differ by unit.
Rate / Percentage
Store using exact decimal serialization.
Do not depend on SQLite floating-point storage for monetary data.
Every value must survive:
```text
UI
 ↓
Domain
 ↓
SQLite
 ↓
Domain
 ↓
PDF
```
without changing digits.
---
17. Calculation Architecture
Create one authoritative calculation service.
```text
CalculationService
├── calculate_gross_amount()
├── calculate_discount()
├── calculate_taxable_amount()
├── determine_tax_treatment()
├── calculate_cgst_sgst()
├── calculate_igst()
├── calculate_tax_summary()
├── calculate_round_off()
├── calculate_invoice_totals()
└── calculate_amount_words()
```
No duplicate tax formulas elsewhere.
The UI displays results produced by this service.
The PDF renders results produced by this service.
---
18. Tax Treatment
Place of supply must be an explicit invoice value.
The supported normal flow is:
```text
Supplier State
       +
Place of Supply
       ↓
Tax Treatment
```
Normal supported cases:
```text
Intra-state → CGST + SGST
Inter-state → IGST
```
Tax rates are configurable.
Do not permanently hardcode 9% + 9% or 18%.
---
19. GST Scope
The application must explicitly define supported special cases.
Recommended Version 1 scope:
```text
SUPPORTED
├── Normal intra-state taxable supply
├── Normal inter-state taxable supply
└── Configurable GST rates

NOT SUPPORTED BY DEFAULT
├── Reverse charge
├── Exempt supply
├── Nil-rated supply
├── Export
├── SEZ
└── Other special GST treatments
```
Unsupported cases must fail with a clear message rather than silently being converted into a generic zero-tax invoice.
If e-invoicing is legally applicable to the business, the local PDF generator does not itself provide IRP registration, IRN generation, or an IRP-signed QR. That would require a separately approved integration and is outside the offline-only runtime architecture.
---
20. Tax Summary Architecture
Tax summary grouping key:
```text
HSN/SAC
+
Tax Treatment
+
Applicable Rate Tuple
```
Not merely:
```text
HSN/SAC
```
Example:
```text
998898 | INTRA_STATE | CGST 9% + SGST 9%
998898 | INTRA_STATE | CGST 12% + SGST 12%
998898 | INTER_STATE | IGST 18%
```
The summary should aggregate already-calculated line tax values.
It must not recalculate tax independently from the aggregated taxable value.
---
21. Round-Off Architecture
The calculation flow is:
```text
Raw Total
    ↓
Rounded Total
    ↓
Round-Off = Rounded Total - Raw Total
```
Then:
```text
Grand Total = Raw Total + Round-Off
```
Round-off may be positive or negative.
The rounding policy must be explicit and covered by tests.
---
22. Invoice Numbering
Use a dedicated sequence repository.
Do not use:
```sql
SELECT MAX(invoice_number)
```
The sequence scope should include:
```text
Company
Financial Year
Prefix
Next Sequence
```
Example:
```text
SE / 26-27 / 043
```
Finalization:
```text
BEGIN TRANSACTION
       ↓
Validate
       ↓
Reserve sequence
       ↓
Build invoice number
       ↓
Persist invoice
       ↓
Persist lines
       ↓
Persist snapshots
       ↓
COMMIT
```
---
23. Financial Year
Financial year must be derived from invoice date according to the business's configured financial-year convention.
The architecture must define behavior around:
```text
31 March
1 April
```
and for:
Backdated invoices
Future-dated invoices where allowed
Prefix changes
Sequence rollover
Existing Tally number initialization
The sample invoice numbers do not prove what the next number should be. Initial sequence must be configured explicitly.
---
24. Transaction Ownership
Invoice finalization must have exactly one transaction owner.
Recommended:
```text
InvoiceService
      ↓
Unit of Work / Transaction Scope
      ↓
Repositories
```
Repositories must participate in the transaction and must not commit independently.
One finalization transaction covers:
Sequence reservation
Invoice header
Invoice lines
Totals
Snapshot fields
Finalization state
If any part fails:
```text
ROLLBACK
```
No partial invoice may remain.
---
25. Repeat-Finalize Protection
The application must safely handle:
```text
User clicks Finalize
      ↓
Request succeeds
      ↓
User clicks Finalize again
```
The second request must not:
create a second invoice
reserve a second sequence
duplicate line items
It should either:
return the already-finalized invoice, or
return a clear "already finalized" result.
---
26. Concurrent Access
The product is single-user/local, but the application should still behave safely if:
Two application windows are opened.
Two finalization operations overlap.
A stale draft is being edited.
Use SQLite transaction locking and unique constraints appropriately.
Do not disable SQLite thread-safety checks simply to suppress errors.
If database work is moved to a worker thread, use worker-owned connections.
---
27. Repository Architecture
Define interfaces:
```text
CompanyRepository
CustomerRepository
InvoiceRepository
SequenceRepository
SettingsRepository
```
Application services depend on these interfaces.
SQLite implements them.
Example:
```text
src/domain/repositories/
├── company_repository.py
├── customer_repository.py
├── invoice_repository.py
├── sequence_repository.py
└── settings_repository.py
```
Implementation:
```text
src/infrastructure/database/
├── sqlite_connection.py
├── transaction.py
├── migrations/
├── company_repository.py
├── customer_repository.py
├── invoice_repository.py
├── sequence_repository.py
└── settings_repository.py
```
---
28. SQLite Architecture
SQLite is the source of truth for local invoice data.
Recommended core tables:
```text
companies
customers
invoices
invoice_items
invoice_sequences
app_settings
assets
```
A tax-summary table is optional if summary data can be deterministically generated from stored invoice lines.
Avoid duplicating derived data without a clear reason.
---
29. Database Constraints
Use database constraints as a second line of defense.
Examples:
Unique finalized invoice number
Valid status values
Valid payment status values
Foreign-key integrity
Required finalized fields
Positive quantities where appropriate
Valid sequence uniqueness
Application validation must still provide friendly user messages.
---
30. Migration Architecture
Use explicit schema versions.
```text
schema_version
```
Startup:
```text
Open DB
   ↓
Read schema version
   ↓
Apply pending migrations
   ↓
Validate schema
   ↓
Start application
```
Never replace a production database simply because the application version changed.
Each migration should be:
Ordered
Idempotent where appropriate
Tested
Reviewable
Migration failure must stop startup safely rather than leaving the application operating against a partially migrated schema.
---
31. Application Services
Recommended services:
```text
InvoiceService
CustomerService
CompanyService
CalculationService
PDFService
PrintService
BackupService
SettingsService
```
Services should contain use-case orchestration.
Example:
```text
InvoiceService.finalize()
    ↓
validate draft
    ↓
determine tax
    ↓
calculate totals
    ↓
open transaction
    ↓
reserve invoice number
    ↓
create snapshots
    ↓
persist invoice
    ↓
commit
```
---
32. Payment Status
Payment status is separate from invoice status.
Allowed:
```text
UNPAID
PARTIAL
PAID
```
Provide:
```text
PaymentService.update_status()
```
or equivalent application operation.
Payment status changes:
must not modify invoice totals;
must not modify invoice number;
must not alter finalized invoice content;
must be locally persisted.
Version 1 should not claim an authoritative outstanding balance unless actual payment amounts are tracked.
---
33. Cancellation
Cancellation must preserve the original record.
Recommended fields:
```text
cancelled_at
cancel_reason
```
Optionally:
```text
replacement_invoice_id
```
The UI must distinguish:
```text
Discard Draft
```
from:
```text
Cancel Finalized Invoice
```
A cancelled invoice must retain:
Original number
Original values
Original snapshots
The application must not claim that local cancellation updates external tax filings or an IRP.
---
34. Duplication
Duplication creates:
```text
Finalized Invoice
      ↓
New Draft
```
Do not carry over:
Original invoice ID
Official invoice number
Finalized status
Payment status
Finalized calculated totals as authoritative data
The duplicate should recalculate when finalized.
Fields such as date, payment terms, references, customer and technical details may be copied according to documented product behavior.
---
35. PDF Architecture
PDF generation is isolated from database access.
```text
InvoiceService
      ↓
InvoiceRenderDTO
      ↓
PDFService
      ↓
InvoiceRenderer
      ↓
ReportLab
      ↓
PDF
```
The renderer must not:
Query SQLite
Calculate GST
Generate invoice numbers
Change invoice state
It only renders prepared invoice data.
---
36. Render DTO
The PDF renderer should receive a dedicated immutable/read-only render DTO.
It should contain everything required to render the document:
```text
Invoice identity
Company snapshot
Customer snapshot
Bill-to
Ship-to
References
Mould/job lines
Tax details
Totals
Words
Payment details
Notes
Terms
Declaration
Assets
Template version
Invoice status
Payment status presentation
```
This prevents the renderer from reaching back into application state.
---
37. PDF Components
Recommended renderer components:
```text
InvoiceRenderer
├── HeaderRenderer
├── InvoiceMetadataRenderer
├── PartyDetailsRenderer
├── ReferenceDetailsRenderer
├── LineItemsRenderer
├── TaxSummaryRenderer
├── TotalsRenderer
├── AmountWordsRenderer
├── PaymentRenderer
├── NotesRenderer
├── TermsRenderer
├── DeclarationRenderer
├── SignatureRenderer
└── FooterRenderer
```
Components should focus on presentation only.
---
38. PDF Input Safety
User-controlled strings may contain:
```text
&
<
>
```
Do not insert raw user text into ReportLab markup.
Escape text before using paragraph markup.
The PDF font set must support:
₹
×
Normal Latin text
Required punctuation
Long technical descriptions must wrap without clipping.
---
39. PDF Layout
The PDF follows `PDF_LAYOUT.md`.
Main order:
```text
1. Header / Branding
2. Invoice Metadata
3. Bill To / Ship To
4. References / Logistics
5. Mould / Machining Line Items
6. Tax Summary
7. Totals
8. Amount in Words
9. Payment / Bank Details
10. Notes
11. Terms & Conditions
12. Declaration
13. Signature
14. Footer / Page Number
```
The design should combine:
```text
Tally information density
+
Modern hierarchy
+
Mould technical readability
```
---
40. PDF Optional Sections
Optional content should disappear cleanly.
Examples:
Due date
PO
Vehicle
UPI QR
Notes
Signature image
Do not print meaningless empty labels unless the layout explicitly requires a stable structure.
---
41. Long Document Handling
For multi-page invoices:
Repeat table headings.
Prevent row clipping where practical.
Preserve long descriptions.
Keep totals together where possible.
Keep signature/declaration on the final page.
Show page numbers on every page.
Very large blocks must have fallback behavior.
Do not use unconditional "keep together" rules that can make an element impossible to render.
---
42. PDF Preview
Preview, export and print must use the same generated PDF.
```text
Invoice
   ↓
PDFService
   ↓
PDF
 ├── Preview
 ├── Export
 └── Print
```
Do not create a separate HTML/UI version of the invoice for preview if the actual output is the ReportLab PDF.
---
43. Printing Architecture
Printing is an infrastructure concern.
```text
PDFService
    ↓
PrintService
    ↓
PrintAdapter
    ↓
Operating System Printer
```
Use an interface:
```text
PrintAdapter
```
with platform-specific implementations.
Start with Windows as the primary supported platform.
The business/domain layers must have no dependency on Windows print APIs.
---
44. Export Architecture
Export should use a safe file-writing flow:
```text
Generate PDF
    ↓
Write temporary file
    ↓
Flush / verify
    ↓
Atomic move to destination
```
Do not overwrite an existing PDF silently unless that behavior is explicitly chosen by the user.
Export failure must never modify invoice data.
---
45. Backup Architecture
Backup is a first-class reliability feature, not an end-of-project utility.
Use SQLite's supported backup mechanism rather than blindly copying a live database file.
Backup package should contain:
```text
database
application/schema version
required assets
manifest
```
Conceptually:
```text
Live Database
      ↓
BackupService
      ↓
Temporary Backup
      ↓
Integrity Validation
      ↓
Published Backup
```
Never publish a backup that has not been validated.
---
46. Restore Architecture
Restore must be staged.
```text
Select Backup
      ↓
Validate File
      ↓
Validate Schema
      ↓
Validate DB Integrity
      ↓
Validate Required Assets
      ↓
Create Safety Backup of Current Data
      ↓
Stop Writes / Close Connections
      ↓
Replace Database
      ↓
Reload
```
If replacement or reload fails:
```text
Recover from safety backup
```
A restore must not silently overwrite current usable data.
---
47. Restore and Invoice Numbering
Restoring an older backup can reintroduce an old sequence.
Example:
```text
Backup contains invoices through 100

Later:
101, 102, 103 issued

Restore old backup

Database thinks:
next = 101
```
The unique constraint cannot prevent reuse of invoices that are no longer present in the restored database.
Therefore, restored data must enter a recovery/reconciliation state when necessary.
The operator must confirm the current high-water mark for affected invoice series before new finalization.
The application should prevent silent reuse.
This safeguard does not recover missing invoice records; it only prevents accidental reuse of their numbers.
---
48. Asset Backup / Restore
Because finalized invoices can reference versioned assets, backup/restore must preserve:
```text
Logo versions
Signature versions
Other invoice assets
```
Restore must validate that required assets exist.
If an asset is missing:
do not silently substitute a newer asset;
report the missing asset;
preserve the current database if restore cannot be completed safely.
---
49. File System Architecture
Use platform-aware user-data paths.
Conceptually:
```text
User Data/
├── database/
│   └── invoices.db
│
├── exports/
│   └── *.pdf
│
├── backups/
│   └── *.backup
│
├── assets/
│   ├── logos/
│   └── signatures/
│
└── logs/
    └── app.log
```
Do not hardcode Unix-style `~/.invoices_local` into application behavior.
Resolve the platform-appropriate application-data directory.
---
50. Configuration Architecture
User-editable configuration should be stored locally.
Examples:
Company details
Bank details
UPI
Invoice numbering
Default tax
Default payment terms
Default notes
Default terms
Declaration
Export path
Backup settings
Current template configuration
`.env` must not be required for normal end-user operation.
---
51. Application Composition Root
Use one composition root.
Suggested:
```text
src/bootstrap.py
```
Responsibilities:
Resolve paths
Open database
Run migrations
Create repositories
Create domain/application services
Create infrastructure adapters
Create UI dependencies
Conceptually:
```text
SQLiteConnection
       ↓
Repositories
       ↓
Services
       ↓
Controllers / Models
       ↓
PySide6 UI
```
No random service construction from individual widgets.
---
52. UI Architecture
Use PySide6 Model/View patterns for lists and tables.
Suggested modules:
```text
src/ui/
├── main_window.py
│
├── dashboard/
├── customers/
│   ├── customer_list.py
│   └── customer_form.py
│
├── invoices/
│   ├── invoice_list.py
│   ├── invoice_form.py
│   └── invoice_preview.py
│
├── settings/
│   └── settings_window.py
│
└── common/
    ├── dialogs.py
    ├── validation.py
    └── widgets.py
```
Avoid a giant `MainWindow` containing the entire application.
---
53. Invoice UI State
The invoice form should explicitly distinguish:
```text
Draft editing
Finalization validation
Finalized read-only view
Cancelled view
```
Draft actions
```text
Save Draft
Close
Delete Draft
Finalize
```
Finalized actions
```text
View
Preview
Print
Export
Mark Payment Status
Cancel
Duplicate
```
Cancelled actions
```text
View
Preview
Export
Duplicate
```
Do not show "Save" or unrestricted editing controls for finalized invoices.
---
54. Dirty State Handling
The invoice editor must track unsaved changes.
When closing a dirty draft:
```text
Save
Discard
Cancel
```
must be offered where appropriate.
"Cancel invoice" must never be used for merely closing an unsaved draft.
---
55. Error Handling
Define application-level errors:
```text
ValidationError
InvoiceStateError
DuplicateInvoiceNumberError
DatabaseError
MigrationError
PDFGenerationError
PrintError
BackupError
RestoreError
AssetError
```
UI converts these to business-friendly messages.
Domain/application services must not display UI dialogs directly.
---
56. Logging
Use standard Python logging.
Log:
Startup/shutdown
Migration errors
Invoice finalization failures
PDF failures
Printer failures
Backup failures
Restore failures
Do not log:
Unnecessary customer personal information
Sensitive payment credentials
Full invoice contents unless intentionally required for diagnostics
Normalize paths when configuring handlers so repeated logger setup does not create duplicate handlers.
---
57. Threading Rules
Most local database operations may remain synchronous.
Potentially long operations:
PDF generation for unusually large invoices
Backup
Restore
Large file operations
These may use worker threads.
Rule:
> Never block the PySide6 UI thread with a noticeably long-running operation.
If SQLite access occurs from a worker:
Use a connection created for that worker.
Respect SQLite thread-affinity rules.
Do not globally disable thread checks as a shortcut.
---
58. Backup and Worker Interaction
Before backup/restore:
```text
Coordinate active DB work
        ↓
Ensure transaction state is stable
        ↓
Perform backup/restore
```
There must be a clear connection-lifetime policy.
No background task may continue writing to a database while restore is replacing it.
---
59. Performance
The application is intended for a small-business local workload.
Target:
Fast startup
Responsive invoice form
Fast customer search
Fast invoice search
PDF generated within a few seconds for normal invoices
Thousands of invoices remain usable
Do not use:
Distributed caching
Message brokers
Remote services
to solve a workload SQLite can handle.
---
60. Security and Data Integrity
The application is local-only, so the key security concerns are:
Safe SQL
Local file permissions
Data loss prevention
Reliable backup
Controlled destructive operations
Immutable finalized records
Use parameterized SQL.
Do not execute SQL built from user input.
---
61. Testing Architecture
Testing follows the same boundaries as production code.
```text
Unit
  ↓
Repository
  ↓
Service
  ↓
PDF
  ↓
UI / Integration
  ↓
Packaged Windows smoke test
```
61.1 Domain Unit Tests
Test:
Money parsing
Decimal serialization
GST calculations
Discount
Round-off
Tax-summary grouping
Amount in words
Validation
Numbering rules
Status transitions
61.2 Repository Tests
Test:
Save/load
Exact numeric round trips
Foreign keys
Constraints
Transactions
Migrations
Sequence behavior
61.3 Service Tests
Test:
Draft creation
Draft save/reopen
Finalization
Repeat finalization
Cancellation
Duplication
Payment status
Snapshot creation
Master-data changes after finalization
61.4 PDF Tests
Test:
PDF opens
A4 size
Required fields
Required symbols
Correct totals
Correct tax
Technical descriptions
Special characters
Long names
Long addresses
Multi-page invoices
Missing optional assets
61.5 Recovery Tests
Test:
Backup
Corrupt backup
Missing asset
Unsupported schema
Failed replacement
Restore on a clean profile
Number reconciliation after restoring an old backup
61.6 UI Tests
Focus on critical workflows rather than implementation details of every widget.
---
62. Golden Invoice Fixtures
Use fixture data under:
```text
tests/fixtures/
├── invoice_043.json
└── invoice_089.json
```
The documented aggregate values are:
Invoice 043
```text
Taxable Value : ₹12,280.00
CGST          : ₹1,105.20
SGST          : ₹1,105.20
Round-Off     : -₹0.40
Grand Total   : ₹14,490.00
```
Invoice 089
```text
Taxable Value : ₹8,332.00
CGST          : ₹749.88
SGST          : ₹749.88
Round-Off     : ₹0.24
Grand Total   : ₹9,832.00
```
Do not invent missing original line-level inputs.
Where only aggregate values are known, tests must be labelled as aggregate regression tests rather than claiming complete pixel/value reproduction of the original source invoice.
---
63. Testing Financial Precision
Tests must cover:
₹0.01
Small taxable amounts
Paise
Fractional quantities
Discounts
Multiple tax rates
Same HSN/SAC with different tax rates
Positive round-off
Negative round-off
Large valid totals
Invalid negative values
NaN/infinity rejection
Every numeric round trip must be exact.
---
64. Windows-First Validation
Primary release platform:
```text
Windows
```
A Windows smoke-test environment must prove:
Clean install
Clean launch
Database creation
Company setup
Customer setup
Invoice creation
Finalization
PDF generation
Preview
Printer discovery
Print
Backup
Restore
Offline operation
Data-preserving upgrade
Cross-platform packaging is optional future work unless a business requirement requires it.
---
65. Packaging Architecture
Separate application installation from user data.
```text
Application Install
        ≠
User Data
```
Example:
```text
Application directory
    ↓
Executable + bundled dependencies

User AppData directory
    ↓
Database
Exports
Backups
Assets
Logs
```
An application update must not delete invoice data.
---
66. Reproducible Build
Packaging configuration should be committed to source control.
The build should define:
Python version
Dependency versions/ranges
Application version
Bundled assets
Entry point
Windows packaging configuration
Do not rely on an undocumented development environment.
---
67. Application Startup
Startup sequence:
```text
Launch
  ↓
Resolve user data directory
  ↓
Initialize logging
  ↓
Open SQLite
  ↓
Run migrations
  ↓
Validate required configuration
  ↓
Create repositories
  ↓
Create services
  ↓
Create UI models/controllers
  ↓
Open main window
```
No network health check is allowed.
If migration or database initialization fails, fail safely with a clear error.
---
68. Application Shutdown
Shutdown should:
```text
Stop background operations
      ↓
Finish/cancel supported tasks
      ↓
Flush logging
      ↓
Commit/rollback active transactions
      ↓
Close DB connections
      ↓
Exit
```
Restore cannot occur while another component still owns an active write connection.
---
69. Offline Boundary
The runtime must operate fully without internet access.
Required offline workflows:
```text
Create customer
Create draft
Finalize invoice
Calculate GST
Generate PDF
Preview
Print
Export
Search
Backup
Restore
```
There must be no runtime dependency on:
AWS
Azure
Google Cloud
External APIs
Online GST services
Cloud authentication
Remote databases
---
70. Architecture Folder Structure
Recommended final structure:
```text
invoice-generator/
│
├── .kiro/
│   ├── steering/
│   │   ├── product-rules.md
│   │   ├── architecture.md
│   │   └── coding-standards.md
│   │
│   ├── hooks/
│   │
│   └── specs/
│       └── invoice-generator/
│           ├── requirements.md
│           ├── design.md
│           └── tasks.md
│
├── docs/
│   ├── README.md
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── OPEN_QUESTIONS.md
│   ├── INSTALL_TEST.md
│   ├── MANUAL_SMOKE_TEST.md
│   └── feature/
│       └── invoice-generator/
│           ├── README.md
│           ├── INVOICE_RULES.md
│           ├── PDF_LAYOUT.md
│           └── ACCEPTANCE_E2E.md
│
├── src/
│   ├── main.py
│   ├── bootstrap.py
│   │
│   ├── domain/
│   │   ├── models/
│   │   ├── enums/
│   │   ├── rules/
│   │   └── repositories/
│   │
│   ├── application/
│   │   ├── services/
│   │   ├── dto/
│   │   └── errors/
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   │   └── migrations/
│   │   ├── pdf/
│   │   ├── printing/
│   │   ├── backup/
│   │   └── filesystem/
│   │
│   └── ui/
│       ├── dashboard/
│       ├── customers/
│       ├── invoices/
│       ├── settings/
│       └── common/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── recovery/
│   └── fixtures/
│
├── assets/
├── docs/
├── pyproject.toml
├── README.md
└── .gitignore
```
---
71. Architecture Decision Records
Significant decisions should be recorded separately in:
```text
docs/DECISIONS.md
```
Examples:
```text
ADR-001
PySide6 chosen for desktop UI

ADR-002
SQLite chosen for local persistence

ADR-003
Decimal chosen for money calculations

ADR-004
Finalized invoices are immutable

ADR-005
ReportLab chosen for deterministic PDF rendering

ADR-006
Windows is the first release platform
```
This prevents AI agents from repeatedly revisiting settled decisions.
---
72. Open Questions
Unresolved business decisions must be tracked in:
```text
docs/OPEN_QUESTIONS.md
```
Examples:
Exact invoice-number allocation point
Existing Tally sequence initialization
Supported GST special cases
Exact future-date policy
Restore high-water reconciliation workflow
Payment-status behavior
Historical PDF/template policy
Cancellation workflow for already reported invoices
AI agents must not silently invent answers to these questions.
---
73. Kiro Steering Rules
Kiro should always be reminded of these project constraints:
```text
1. Local desktop billing application.
2. No cloud runtime.
3. No backend server.
4. No REST API.
5. No remote database.
6. PySide6 UI.
7. SQLite persistence.
8. ReportLab PDF.
9. Decimal for money.
10. UI contains no SQL.
11. UI contains no business calculations.
12. PDF renderer contains no business calculations.
13. Finalized invoices are immutable.
14. Invoice numbering is transactional.
15. Historical snapshots are mandatory.
16. Finalized assets are versioned.
17. Backup/restore is a reliability feature.
18. Sample invoice calculations are regression fixtures.
19. Do not add infrastructure without a requirement.
20. Do not silently modify requirements.
```
---
74. Implementation Dependency Order
The recommended implementation sequence is:
```text
0. Contract reconciliation
        ↓
1. Foundation corrections
        ↓
2. Numeric / Decimal policy
        ↓
3. Domain models
        ↓
4. Stage-aware validation
        ↓
5. Calculation engine
        ↓
6. Totals / round-off / tax summary
        ↓
7. Golden fixtures
        ↓
8. SQLite + migrations
        ↓
9. Repositories
        ↓
10. Invoice numbering + FY
        ↓
11. Company / Customer services
        ↓
12. Invoice lifecycle + snapshots
        ↓
13. Early PDF spike
        ↓
14. PDF renderer
        ↓
15. PDF regression tests
        ↓
16. Early Windows print spike
        ↓
17. Composition root
        ↓
18. Customer UI
        ↓
19. Invoice UI
        ↓
20. Invoice history
        ↓
21. Dashboard
        ↓
22. Settings
        ↓
23. Backup / Restore
        ↓
24. Offline acceptance
        ↓
25. Windows packaging
        ↓
26. Final acceptance
```
Tasks 12, 14, 19 and 23 should be decomposed into smaller subtasks before execution.
---
75. Quality Gates
Use stage gates rather than measuring progress by checkbox count.
Gate A — Contracts
Requirements, rules and design agree.
Gate B — Calculations
Financial calculations pass independently.
Gate C — Record Safety
Persistence, finalization, numbering, snapshots and recovery work correctly.
Gate D — Documents
PDF renders correctly and Windows printing is proven.
Gate E — User Workflow
The complete desktop workflow works.
Gate F — Release
Clean Windows installation works offline and data recovery is proven.
Do not move to the next dependent stage when the gate fails.
---
76. Definition of Ready
A task is ready for implementation only when:
```text
Requirement exists
Design exists
Dependencies are complete
Acceptance criteria exist
Test strategy exists
No unresolved blocking question
Scope is clear
```
---
77. Definition of Done
A task is complete only when:
```text
Code implemented
Tests added where applicable
Tests pass
Lint/type checks pass
Acceptance criteria demonstrated
No unrelated changes
Documentation updated when behavior changed
Task status updated
```
A checkbox alone is not evidence of completion.
---
78. Final Architectural Principle
The application should remain deliberately simple.
The complexity worth paying for is:
```text
Financial correctness
Invoice immutability
Safe numbering
Historical snapshots
Reliable backup/restore
Accurate PDF output
Good desktop UX
```
The complexity not worth paying for is:
```text
Cloud infrastructure
Distributed systems
Remote APIs
Microservices
Message queues
Online synchronization
Full ERP features
```
The final target is:
```text
                  KIRO
          Development / AI Tool
                    │
                    ▼
             Python Desktop App
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
     PySide6              Application Services
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
               Domain Rules           Infrastructure
                    │                       │
                    │                ┌──────┼───────┐
                    │                │      │       │
                    ▼                ▼      ▼       ▼
             Decimal GST          SQLite  PDF     Printer
                Engine              │    ReportLab   OS
                                    │
                                    ▼
                              Local Files
                           ┌──────┼──────┐
                           │      │      │
                         PDFs  Backups Assets
```
The architecture is intentionally boring.
For billing software, that is the correct outcome: make the financial rules explicit, keep the state safe, keep the PDF deterministic, and avoid infrastructure that does not solve a real business problem.