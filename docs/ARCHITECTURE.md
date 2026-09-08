# ARCHITECTURE
## Local Desktop Billing Application for Mould / Mould-Machining Business

**Document Version:** 1.0  
**Status:** Architecture Baseline  
**Related Document:** `PRODUCT_REQUIREMENTS.md`

---

# 1. Architecture Goals

The application is a **local desktop billing application** whose primary responsibility is:

```text
Create Invoice
      ↓
Validate
      ↓
Calculate GST / Totals
      ↓
Persist Locally
      ↓
Generate PDF
      ↓
Preview / Print / Export
```

The architecture must optimize for:

- Simplicity
- Correct financial calculations
- Reliable local persistence
- Maintainable desktop UI
- Deterministic PDF generation
- Offline operation
- Easy backup and restore
- Clear separation of UI, business logic and infrastructure
- Testability

The architecture must deliberately avoid unnecessary distributed-system concepts.

---

# 2. Important Technology Boundary

Kiro is the **development environment / AI engineering tool used to build the application**. It is not the runtime framework of the billing application.

Kiro currently provides an IDE for structured agentic development, including Specs, Steering and Hooks. The actual billing application should therefore use a normal Python desktop UI stack rather than treating Kiro as an application UI/runtime framework. citeturn530514search0turn530514search1

Recommended runtime architecture:

```text
Kiro IDE
   │
   │ used to design/build/review
   ▼
Python Desktop Application
   │
   ├── PySide6 UI
   ├── Application Services
   ├── Domain Models / Rules
   ├── SQLite Persistence
   ├── ReportLab PDF Generation
   └── Local OS Printing
```

Kiro Specs should be used to manage the implementation as requirements → design → tasks, while Steering files should contain project-wide engineering rules. citeturn530514search0turn530514search3turn530514search4

---

# 3. High-Level System Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    DESKTOP APPLICATION                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                     Presentation                        │  │
│  │                    PySide6 UI                           │  │
│  │                                                        │  │
│  │ Dashboard | Customers | Invoice | History | Settings  │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  Application Layer                     │  │
│  │                                                        │  │
│  │ InvoiceService     CustomerService     CompanyService │  │
│  │ CalculationService PDFService        BackupService    │  │
│  │ PrintService       SettingsService                  │  │
│  └───────────────┬───────────────────────┬──────────────┘  │
│                  │                       │                  │
│                  ▼                       ▼                  │
│  ┌────────────────────────┐   ┌──────────────────────────┐ │
│  │ Domain / Business Rules│   │ Infrastructure            │ │
│  │                         │   │                          │ │
│  │ Invoice                │   │ SQLite Repository         │ │
│  │ InvoiceLine            │   │ File Storage              │ │
│  │ GST Rules              │   │ PDF Renderer              │ │
│  │ Totals                 │   │ OS Printer                │ │
│  │ Invoice Lifecycle      │   │ Backup / Restore          │ │
│  └────────────────────────┘   └──────────────────────────┘ │
│                                           │                │
└───────────────────────────────────────────┼────────────────┘
                                            ▼
                              ┌──────────────────────────┐
                              │        Local Disk        │
                              │                          │
                              │ SQLite DB                │
                              │ PDFs                     │
                              │ Logo / Signature         │
                              │ Backups                  │
                              │ Logs                     │
                              └──────────────────────────┘
```

There is:

- No backend server
- No REST API
- No cloud database
- No synchronization service
- No message broker
- No internet dependency

---

# 4. Architectural Style

Use a lightweight layered architecture.

```text
Presentation
     ↓
Application Services
     ↓
Domain / Business Rules
     ↓
Repositories / Infrastructure
     ↓
SQLite + File System + OS
```

The key rule is:

> UI code must not contain financial business rules or direct SQL.

For example, the invoice form should not calculate GST itself.

Correct:

```text
InvoiceForm
   ↓
InvoiceService
   ↓
CalculationService
   ↓
Invoice totals
```

Incorrect:

```text
InvoiceForm
   ├── SQL
   ├── GST calculation
   ├── rounding
   ├── PDF generation
   └── print logic
```

---

# 5. Recommended Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Development | Kiro | AI-assisted development, Specs, Steering, Hooks |
| Language | Python | Application runtime |
| Desktop UI | PySide6 | Native desktop user interface |
| Validation | Pydantic | Input/model validation |
| Database | SQLite | Local relational persistence |
| PDF | ReportLab | Invoice PDF generation |
| QR | qrcode | Optional UPI QR |
| Images | Pillow | Logo/signature image handling |
| Amount words | num2words | INR amount-to-words |
| Testing | pytest | Unit/integration tests |
| Packaging | PyInstaller or equivalent | Desktop distribution |

Do not add libraries unless they solve a confirmed requirement.

---

# 6. Layer Responsibilities

## 6.1 Presentation Layer

Location:

```text
src/ui/
```

Responsibilities:

- Render screens
- Collect user input
- Display validation errors
- Display calculated totals
- Trigger application services
- Show dialogs
- Display PDF preview
- Never perform raw database operations
- Never implement GST formulas

Suggested structure:

```text
src/ui/
├── main_window.py
├── dashboard.py
├── customers/
│   ├── customer_list.py
│   └── customer_form.py
├── invoices/
│   ├── invoice_list.py
│   ├── invoice_form.py
│   └── invoice_preview.py
├── settings/
│   └── settings_window.py
└── components/
    ├── address_widget.py
    ├── line_item_table.py
    ├── totals_widget.py
    └── dialogs.py
```

---

# 7. Application Layer

Location:

```text
src/application/
```

This layer coordinates use cases.

Suggested services:

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

Services should depend on interfaces/ports rather than concrete UI components.

Example:

```text
InvoiceService
    ├── InvoiceRepository
    ├── CustomerRepository
    └── CalculationService
```

PDF generation should be isolated:

```text
PDFService
    └── Invoice PDF Renderer
```

Printing should be isolated:

```text
PrintService
    └── OS print adapter
```

This prevents platform-specific printing code from contaminating the business layer.

---

# 8. Domain Layer

Location:

```text
src/domain/
```

The domain layer should contain the business concepts and calculation rules.

Suggested objects:

```text
Company
Customer
Invoice
InvoiceLine
TaxSummary
PaymentDetails
InvoiceTotals
```

Enums:

```text
InvoiceStatus
PaymentStatus
TaxType
```

Possible invoice states:

```text
DRAFT
FINALIZED
CANCELLED
```

Payment states:

```text
UNPAID
PARTIAL
PAID
```

Payment status is independent of invoice lifecycle.

---

# 9. Money Representation

All money calculations must use:

```text
Decimal
```

Never use:

```text
float
```

for:

- Rate
- Discount amount
- Taxable amount
- CGST
- SGST
- IGST
- Round-off
- Grand total
- Amount paid

The goal is deterministic billing calculations.

Recommended conceptual flow:

```text
Quantity × Rate
       ↓
Gross line amount
       ↓
Discount
       ↓
Taxable amount
       ↓
GST
       ↓
Line total
       ↓
Invoice aggregation
       ↓
Round-off
       ↓
Grand total
```

---

# 10. Tax Architecture

Tax calculations should be centralized.

Do not calculate tax independently in:

- UI
- PDF renderer
- database layer

There should be one authoritative calculation implementation.

Example:

```text
CalculationService
       │
       ├── calculate_line_amount()
       ├── calculate_discount()
       ├── calculate_taxable_amount()
       ├── calculate_cgst_sgst()
       ├── calculate_igst()
       ├── calculate_round_off()
       └── calculate_invoice_totals()
```

Tax treatment:

```text
Company State
      +
Customer / Place of Supply
      ↓
Tax Treatment
      ├── INTRA_STATE → CGST + SGST
      └── INTER_STATE → IGST
```

Tax rates must be configurable.

The sample invoices use 18% total tax, shown as 9% CGST + 9% SGST. The reference image demonstrates an IGST presentation.

Do not hardcode 9% + 9% into the architecture.

---

# 11. Rounding Architecture

Round-off must be represented explicitly.

Use:

```text
raw_total
rounded_total
round_off = rounded_total - raw_total
```

The round-off amount must appear independently on the invoice.

All rounding rules should live in one place.

Example:

```text
CalculationService
    ↓
InvoiceTotals
    ├── taxable_amount
    ├── cgst
    ├── sgst
    ├── igst
    ├── raw_total
    ├── round_off
    └── grand_total
```

This logic must have dedicated tests using the sample invoices.

---

# 12. Invoice Domain Model

Conceptually:

```text
Invoice
├── identity
│   ├── id
│   ├── invoice_number
│   └── invoice_date
│
├── parties
│   ├── company
│   └── customer
│
├── references
│   ├── PO
│   ├── challan
│   ├── delivery note
│   ├── dispatch document
│   ├── vehicle
│   └── destination
│
├── commercial
│   ├── payment terms
│   ├── due date
│   └── place of supply
│
├── line_items[]
│
├── totals
│   ├── taxable
│   ├── CGST
│   ├── SGST
│   ├── IGST
│   ├── round-off
│   └── grand total
│
├── notes
├── terms
├── declaration
│
└── status
```

---

# 13. Line Item Architecture

A mould/machining line item should support structured technical information.

Recommended domain structure:

```text
InvoiceLine
├── sequence
├── job_or_mould_reference
├── component_or_part
├── operation
├── description
├── specification
├── hsn_sac
├── quantity
├── unit
├── rate
├── discount_percent
├── tax_rate
└── calculated_amounts
```

The `description` field remains necessary because not every mould operation can be represented by fixed fields.

Example:

```text
Job/Mould: DT-663
Operation: Punch Gun Drilling
Specification: Drill Dia 9 × 307 mm Deep
Qty: 16
Unit: NOS
HSN/SAC: 998898
```

This is preferable to storing the entire technical description as one uncontrolled string.

---

# 14. Repository Architecture

Use repository interfaces to keep persistence independent from application services.

Example:

```text
InvoiceRepository
CustomerRepository
CompanyRepository
```

Interfaces:

```text
src/domain/repositories/
├── invoice_repository.py
├── customer_repository.py
└── company_repository.py
```

SQLite implementations:

```text
src/infrastructure/database/
├── sqlite_connection.py
├── invoice_repository.py
├── customer_repository.py
└── company_repository.py
```

The service layer depends on repository interfaces.

This makes testing easier and prevents SQL from leaking into business logic.

---

# 15. Database Architecture

Use SQLite as the local relational database.

Conceptual entities:

```text
companies
customers
invoices
invoice_items
invoice_sequences
```

Optional:

```text
invoice_tax_summaries
service_templates
app_settings
```

Do not create tables simply because they are theoretically possible.

---

# 16. Database Relationships

```text
COMPANY
   │
   └─────────────┐
                 │
                 ▼
              INVOICE
                 │
                 ├────────── CUSTOMER
                 │
                 └──────────< INVOICE_ITEM
```

One invoice has many line items.

One customer can have many invoices.

Invoice line items must be deleted when their parent draft invoice is intentionally deleted.

Finalized invoices should not be hard-deleted through normal application workflows.

---

# 17. Invoice Snapshot Principle

A finalized invoice should represent what was actually billed at the time it was finalized.

Therefore, the PDF must not rely blindly on today's customer/company master data.

When an invoice is finalized, the application should preserve the required invoice-facing values, including:

- Company name/address/GSTIN
- Customer name/address/GSTIN
- Billing information
- Shipping/consignee information
- Invoice references
- Line item values
- Tax values
- Totals
- Notes/terms/declaration

This prevents editing a customer master tomorrow from silently changing a historical invoice.

A practical implementation is to store invoice-specific snapshot fields alongside the foreign keys to the masters.

---

# 18. Invoice Numbering Architecture

Invoice numbering requires a dedicated sequence mechanism.

Do not calculate the next number by simply:

```text
SELECT MAX(invoice_number)
```

because string parsing and race conditions make that fragile.

Use:

```text
invoice_sequences
```

conceptually:

```text
company_id
financial_year
prefix
next_sequence
```

At invoice finalization:

```text
Begin transaction
    ↓
Reserve next sequence
    ↓
Build invoice number
    ↓
Persist invoice
    ↓
Commit
```

Because the application is single-computer, this remains simple while still being correct.

---

# 19. Draft vs Finalized Data

### Draft

Can be:

- Created
- Edited
- Deleted
- Saved repeatedly

### Finalized

Should be:

- Number locked
- Financial values locked
- Customer/company invoice-facing values preserved
- Printable
- Exportable
- Reprintable

### Cancelled

Should:

- Preserve the original record
- Preserve invoice number
- Preserve original values
- Show cancellation state

This is better than using a generic `is_deleted` flag for finalized invoices.

---

# 20. PDF Architecture

PDF generation should be a separate infrastructure/application service.

```text
Invoice
  ↓
PDFService
  ↓
InvoiceRenderer
  ↓
ReportLab
  ↓
PDF bytes
  ↓
Save / Preview / Print
```

Recommended modules:

```text
src/infrastructure/pdf/
├── invoice_renderer.py
├── styles.py
├── components.py
├── tables.py
├── amount_words.py
└── qr_renderer.py
```

The renderer should receive already-calculated invoice data.

It should **not perform accounting calculations**.

---

# 21. PDF Layout Architecture

The invoice should be rendered in this order:

```text
1. Header / Branding
2. Invoice Metadata
3. Bill To / Ship To
4. Reference / Logistics Details
5. Mould / Machining Line Items
6. Tax Summary
7. Totals
8. Amount in Words
9. Payment / Bank Details
10. Notes
11. Terms & Conditions
12. Declaration
13. Authorized Signatory
14. Footer / Page Number
```

The visual style should combine:

- Tally's detailed accounting information
- The reference image's clearer visual hierarchy

---

# 22. PDF Rendering Strategy

Prefer deterministic programmatic layout.

Use ReportLab tables and drawing primitives.

Avoid depending on browser rendering unless a later requirement specifically needs HTML-based templates.

The PDF renderer should have reusable components:

```text
InvoiceHeader
PartyDetails
InvoiceReferences
LineItemsTable
TaxSummary
TotalsBlock
PaymentBlock
NotesBlock
TermsBlock
SignatureBlock
Footer
```

This keeps the PDF implementation maintainable.

---

# 23. PDF Preview Architecture

The application should not duplicate the invoice layout in a separate visual preview.

Preferred flow:

```text
Invoice
   ↓
PDFService
   ↓
PDF file/bytes
   ↓
OS PDF viewer or embedded viewer
```

The preview should show the same document that will be printed/exported.

Avoid maintaining two independent rendering implementations.

---

# 24. Printing Architecture

The application generates one authoritative PDF.

Printing uses that PDF.

```text
Invoice
   ↓
PDFService
   ↓
PDF
   ↓
PrintService
   ↓
Operating System Printer
```

The print adapter should be replaceable for Windows/macOS/Linux.

The business layer should know nothing about Windows print APIs or other platform-specific details.

---

# 25. File Storage Architecture

Use an application data directory appropriate for the operating system.

Conceptually:

```text
App Data/
├── database/
│   └── invoices.db
├── exports/
├── backups/
├── assets/
│   ├── logo
│   └── signature
└── logs/
```

Do not hardcode Unix-style paths in application logic.

Use a platform-aware path abstraction.

---

# 26. Backup Architecture

Backups are local.

```text
SQLite DB
   ↓
BackupService
   ↓
Timestamped backup file
```

Support:

- Manual backup
- Manual restore
- Optional automatic backups

Before destructive database replacement:

```text
Current DB
   ↓
Safety backup
   ↓
Validate selected backup
   ↓
Restore
   ↓
Restart/reload application
```

Restoring must not silently destroy the current database.

---

# 27. Asset Management

Company assets:

- Logo
- Signature/stamp

should be stored outside the SQLite database as local files unless there is a strong reason to embed them.

Database stores:

```text
logo_path
signature_path
```

The PDF renderer loads the files when required.

If the file is missing, the invoice should degrade gracefully and show an appropriate validation/error message.

---

# 28. Configuration Architecture

Use persistent application settings for:

- Company details
- Bank details
- Default GST settings
- Invoice numbering configuration
- Default payment terms
- Default notes
- Default Terms & Conditions
- PDF output location
- Backup settings

Do not put business settings into `.env`.

`.env` is for development/runtime secrets/configuration and should not be required for normal end-user operation.

For this local billing product, user-editable settings should live in the application database or a dedicated local configuration store.

---

# 29. Error Boundary

Errors should be handled at clear boundaries.

```text
UI
 ↓
Application Service
 ↓
Repository / Infrastructure
```

Examples:

```text
DatabaseError
PDFGenerationError
PrinterError
BackupError
ValidationError
```

The UI converts these into user-facing messages.

Business code should not show UI dialogs directly.

---

# 30. Logging Architecture

Use standard Python logging.

Log locally:

```text
logs/app.log
```

Useful events:

- Application startup/shutdown
- Database initialization failure
- Invoice save/finalization failure
- PDF generation failure
- Print failure
- Backup/restore failure

Do not log sensitive data unnecessarily.

---

# 31. Threading / Responsiveness

Most operations are small and can remain synchronous.

Potentially long-running operations:

- PDF rendering for large invoices
- Backup creation
- Restore
- File operations

These can be moved off the UI thread when necessary.

The rule is:

> Never block the PySide6 UI thread with an operation that can take noticeable time.

Do not introduce asynchronous complexity merely for database CRUD that completes immediately on a local SQLite database.

---

# 32. Dependency Injection

Use constructor injection for services and repositories.

Example conceptual structure:

```text
InvoiceService(
    invoice_repository,
    customer_repository,
    calculation_service
)
```

PDF:

```text
PDFService(
    invoice_renderer
)
```

Print:

```text
PrintService(
    pdf_service,
    print_adapter
)
```

This makes unit testing straightforward.

---

# 33. Application Composition Root

Create one composition root responsible for wiring dependencies.

Example:

```text
src/bootstrap.py
```

Conceptually:

```text
SQLiteConnection
      ↓
Repositories
      ↓
Services
      ↓
Controllers/ViewModels
      ↓
PySide6 UI
```

The rest of the application should not instantiate dependencies randomly.

---

# 34. UI State Management

Avoid putting all state into one gigantic MainWindow class.

Suggested:

```text
MainWindow
   ├── DashboardController
   ├── CustomerController
   ├── InvoiceController
   └── SettingsController
```

For PySide6, use a predictable model/view approach for:

- Customer lists
- Invoice lists
- Invoice line-item tables

This avoids fragile direct manipulation of widgets.

---

# 35. Invoice Form Data Flow

```text
User selects Customer
        ↓
CustomerService
        ↓
Customer data loaded
        ↓
Invoice draft state updated

User adds line item
        ↓
InvoiceController
        ↓
InvoiceService / CalculationService
        ↓
Totals updated
        ↓
UI refreshed

User clicks Finalize
        ↓
Validate
        ↓
Reserve invoice number
        ↓
Calculate final totals
        ↓
Persist final invoice
        ↓
Generate PDF
        ↓
Preview / Print
```

---

# 36. Customer Data Flow

```text
Customer Form
     ↓
Validation
     ↓
CustomerService
     ↓
CustomerRepository
     ↓
SQLite
```

The invoice screen should query the CustomerService rather than SQL directly.

---

# 37. Invoice History Data Flow

```text
Invoice List UI
      ↓
InvoiceService.list(...)
      ↓
InvoiceRepository
      ↓
SQLite
      ↓
Invoice list model
      ↓
PySide6 table
```

Filters:

- Invoice number
- Customer
- Date range
- Invoice status
- Payment status

The list should not load every invoice line item when the user only needs summary information.

---

# 38. Security Model

There is no server security model because the product is local-only.

Security priorities are:

- File-system permissions
- Local access protection
- Safe SQL
- Reliable backups
- Avoiding accidental destructive operations

Use parameterized SQL.

Do not execute user input as SQL.

---

# 39. Network Boundary

The application must not require internet access.

```text
┌───────────────────────────────┐
│       LOCAL APPLICATION       │
│                               │
│ PySide6                       │
│ Python                        │
│ SQLite                        │
│ ReportLab                     │
│ Local Files                   │
│ Local Printer                 │
└───────────────────────────────┘

              X
        INTERNET / CLOUD
```

No runtime service should require:

- AWS
- Google Cloud
- Azure
- REST APIs
- SaaS database
- remote authentication
- remote GST validation

---

# 40. Project Structure

Recommended structure:

```text
invoice-generator/
│
├── .kiro/
│   ├── steering/
│   │   ├── architecture.md
│   │   ├── coding-standards.md
│   │   └── product-rules.md
│   ├── hooks/
│   └── specs/
│       └── invoice-generator/
│           ├── requirements.md
│           ├── design.md
│           └── tasks.md
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
│   └── fixtures/
│
├── assets/
├── docs/
├── pyproject.toml
├── README.md
└── .gitignore
```

The structure is intentionally larger than a single-file application but smaller than a full enterprise architecture.

---

# 41. Testing Architecture

Tests should follow the architecture.

## Unit

Test:

- GST calculations
- Discount calculations
- Round-off
- Amount-to-words
- Invoice numbering
- Validation
- Domain rules

## Repository Tests

Test:

- Customer persistence
- Invoice persistence
- Transaction behavior
- Sequence handling

## Service Tests

Test:

- Create invoice
- Finalize invoice
- Cancel invoice
- Duplicate invoice
- Search/filter
- Backup/restore orchestration

## PDF Tests

Test:

- PDF generated successfully
- Correct page size
- Correct invoice values
- Correct tax values
- Required text present
- Sample invoice calculations reproduced

## UI Tests

Focus on critical workflows rather than testing every widget implementation detail.

---

# 42. Golden Test Invoices

The two real invoices should become fixed regression fixtures.

## Fixture 1

```text
Invoice: SE/26-27/043
Customer: DI-TECH MOULDS
Taxable: ₹12,280.00
CGST: ₹1,105.20
SGST: ₹1,105.20
Round-off: -₹0.40
Total: ₹14,490.00
```

## Fixture 2

```text
Invoice: SE/26-27/089
Customer: BMSS STEEL INDUSTRIES PRIVATE LIMITED
Taxable: ₹8,332.00
CGST: ₹749.88
SGST: ₹749.88
Round-off: ₹0.24
Total: ₹9,832.00
```

These are regression tests for the calculation engine and PDF output.

---

# 43. PDF Acceptance Testing

PDF correctness should be tested at two levels.

### Programmatic

Verify:

- File exists
- PDF opens
- Page count
- Required text exists
- Expected totals exist
- Required sections exist

### Visual

Manually inspect:

- Header alignment
- Company branding
- Customer sections
- Mould line items
- Tax table
- Totals
- Signature
- QR code
- Page breaks
- Printing appearance

The final invoice must be tested both digitally and on paper.

---

# 44. Application Lifecycle

```text
Start Application
       ↓
Resolve App Data Directory
       ↓
Initialize SQLite
       ↓
Run migrations
       ↓
Load Settings
       ↓
Initialize Dependencies
       ↓
Open Main Window
       ↓
User Operations
       ↓
Graceful Shutdown
       ↓
Flush/close DB
```

No cloud health checks or network initialization should exist.

---

# 45. Migration Strategy

Even though SQLite is local, schema migration should be supported from the beginning.

Use a simple schema version mechanism:

```text
schema_version
```

On startup:

```text
Current version
     ↓
Apply pending migrations
     ↓
Open application
```

Never overwrite a user's existing database merely because the application version changed.

---

# 46. Packaging Architecture

Package the Python application as a desktop executable.

A practical first target is Windows.

Deployment should bundle:

- Python runtime
- PySide6
- ReportLab
- SQLite dependency
- Application assets

User data must live outside the executable so application updates do not destroy invoices.

Conceptually:

```text
Application install directory
        ≠
User data directory
```

---

# 47. Configuration vs User Data

Separate:

### Application installation

```text
Program Files / application directory
```

from:

### User data

```text
User AppData directory
├── invoices.db
├── backups
├── exports
├── assets
└── logs
```

This allows upgrading the application without replacing billing data.

---

# 48. Architecture Decisions

## Decision 1

**Use PySide6 for the desktop UI.**

Reason:

- Mature Python desktop UI framework
- Strong table/form support
- Suitable for a business desktop application

## Decision 2

**Use SQLite for persistence.**

Reason:

- Local
- Embedded
- Transactional
- No server
- Appropriate for the intended scale

## Decision 3

**Use ReportLab for invoice PDFs.**

Reason:

- Deterministic programmatic layout
- Strong table support
- Image support
- Suitable for A4 invoices

## Decision 4

**Use Decimal for money.**

Reason:

- Financial precision
- Deterministic rounding

## Decision 5

**Use service/repository separation.**

Reason:

- Keeps UI thin
- Easier testing
- Avoids SQL/business rules in widgets

## Decision 6

**Treat finalized invoices as immutable billing records.**

Reason:

- Protects invoice history
- Prevents accidental modification of historical documents

---

# 49. Explicitly Rejected Architecture

Do not build:

```text
React frontend
        ↓
FastAPI backend
        ↓
PostgreSQL
        ↓
Cloud deployment
```

Do not build:

```text
Desktop UI
   ↓
REST API
   ↓
Remote database
```

Do not build:

```text
Invoice
   ↓
Message Queue
   ↓
PDF Worker
```

Do not build:

```text
Cloud storage
Cloud sync
Online GST API
Remote authentication
```

None of these are required for the stated product scope.

---

# 50. Kiro Development Architecture

Use Kiro itself to enforce the engineering workflow.

Recommended repository structure:

```text
.kiro/
├── steering/
│   ├── product-rules.md
│   ├── architecture.md
│   └── coding-standards.md
│
├── specs/
│   └── invoice-generator/
│       ├── requirements.md
│       ├── design.md
│       └── tasks.md
│
└── hooks/
```

Kiro's documented workflow supports Specs for structured requirements/design/tasks and Steering files for persistent project guidance. Hooks can automate actions such as tests, formatters and type checks after code changes. citeturn530514search0turn530514search3turn530514search4turn530514search7

Recommended Kiro workflow:

```text
PRODUCT_REQUIREMENTS.md
        ↓
Kiro Spec
        ↓
requirements.md
        ↓
design.md
        ↓
tasks.md
        ↓
Implementation
        ↓
Tests
        ↓
Review
```

---

# 51. Kiro Steering Rules

The project steering should explicitly tell the agent:

```text
1. This is a local desktop billing application.
2. No cloud runtime dependency.
3. No REST API.
4. No remote database.
5. PySide6 is the UI framework.
6. SQLite is the persistent store.
7. ReportLab is the PDF engine.
8. Decimal must be used for money.
9. UI must not contain business calculations.
10. UI must not execute SQL directly.
11. Finalized invoices are immutable.
12. All invoice calculations must have automated tests.
13. Sample invoices are golden regression fixtures.
14. Do not add infrastructure without a confirmed requirement.
```

These rules should remain persistent across Kiro sessions.

---

# 52. Implementation Dependency Order

Build in this order:

```text
1. Project foundation
        ↓
2. Domain models
        ↓
3. Calculation engine
        ↓
4. SQLite repositories
        ↓
5. Invoice lifecycle
        ↓
6. PDF renderer
        ↓
7. Customer UI
        ↓
8. Invoice UI
        ↓
9. Invoice history
        ↓
10. Settings
        ↓
11. Backup/restore
        ↓
12. Printing
        ↓
13. Packaging
```

This order prevents the UI from becoming the place where business rules are accidentally designed.

---

# 53. Non-Functional Requirements

The architecture must provide:

### Reliability

- No loss of finalized invoice data during normal operation
- Transactions for invoice finalization
- Local backups

### Correctness

- Deterministic financial calculations
- Reproducible PDF values
- Stable invoice numbers

### Maintainability

- Small focused services
- Repository abstraction
- Clear separation of concerns

### Performance

- Responsive UI
- Fast local searches
- PDF generation within a few seconds for normal invoices

### Offline Operation

- No runtime network requirement

---

# 54. Definition of Architectural Success

The architecture is successful when:

```text
A business operator
       ↓
opens desktop application
       ↓
selects customer
       ↓
enters mould/job machining details
       ↓
enters quantity/rate
       ↓
system calculates GST
       ↓
invoice is finalized
       ↓
data is safely stored locally
       ↓
professional PDF is generated
       ↓
PDF is previewed / printed / exported
```

and every step can be tested independently.

---

# 55. Final Architecture Summary

```text
                    KIRO
          (Development Environment)
                       │
                       ▼
              ┌─────────────────┐
              │ Python Desktop  │
              │   Application   │
              └────────┬────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           ▼                       ▼
      ┌─────────┐            ┌─────────────┐
      │ PySide6 │            │ Application │
      │   UI    │───────────▶│  Services   │
      └─────────┘            └──────┬──────┘
                                    │
                 ┌──────────────────┼─────────────────┐
                 │                  │                 │
                 ▼                  ▼                 ▼
            Domain Rules       Repositories       PDF/Print
                 │                  │                 │
                 │                  ▼                 ▼
                 │              SQLite DB        ReportLab / OS
                 │
                 ▼
          Decimal GST Engine

                       ↓
                 Local File System
              ┌────────┼─────────┐
              │        │         │
            PDFs     Backups    Assets
```

This architecture is intentionally **boring**. That is a good thing for billing software: the important engineering work is correctness, invoice immutability, tax calculation, PDF accuracy, persistence and recovery—not distributed infrastructure.
