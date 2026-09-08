# PRODUCT REQUIREMENTS
## Local Desktop Billing Application for Mould / Mould-Machining Business

**Document Version:** 1.0  
**Status:** Requirements Baseline  
**Scope:** Local desktop invoice generation only  
**Primary Output:** Professional GST tax invoice PDF suitable for printing and sharing  
**Offline Requirement:** 100% local; no cloud or online dependency

---

# 1. Product Overview

Build a **single-computer desktop billing application** for a mould / mould-machining business in India.

The application is intended primarily to:

- Maintain company billing information.
- Maintain customer information.
- Create and manage tax invoices.
- Enter mould/job/machining details.
- Automatically calculate GST and invoice totals.
- Generate professional A4 PDF invoices.
- Print invoices using a local printer.
- Save invoice data locally.
- Search and view previously created invoices.
- Back up and restore local billing data.

The application is **not an ERP, CRM, accounting suite, manufacturing system, or cloud SaaS product**.

The application must remain useful without an internet connection.

---

# 2. Source Documents

The requirements are based on the following references:

1. `INV NO 043 DI-TECH MOULDS.pdf`
2. `INV NO 089 BMSS STEEL.pdf`
3. Tata Motors tax invoice reference image

The two Tally invoices demonstrate the actual billing information used for machining/gundrilling work. The Tata Motors sample is used primarily as a reference for a cleaner, more professional invoice presentation.

---

# 3. Product Scope

## 3.1 In Scope

### Core
- Company master
- Customer master
- Invoice creation
- Invoice editing while still a draft
- Invoice finalization
- Invoice numbering
- Invoice history
- Invoice search/filter
- GST calculation
- Amount-to-words conversion
- PDF generation
- PDF preview
- PDF export
- Local printing
- Payment information on invoice
- Notes and terms
- Local backup and restore

### Mould / Machining
- Job/mould reference
- Operation/process
- Technical specification
- Dimensions
- Quantity
- Unit
- Rate
- HSN/SAC
- Free-text description

## 3.2 Out of Scope

Do not build these into Version 1:

- Cloud storage
- Online synchronization
- REST API
- Web application
- Mobile application
- Online customer portal
- Online payment gateway
- Multi-tenant SaaS architecture
- Real-time synchronization
- Payroll
- CRM
- Purchase management
- Full inventory management
- Manufacturing planning
- IoT integration
- Kafka / Redis / message queues
- Server-side database
- Mandatory user accounts
- Live GSTIN verification
- Email delivery service
- Automatic online software updates

---

# 4. User Profile

The primary user is a small-business billing operator who needs to generate invoices quickly.

The application should favor:

- Speed
- Clear forms
- Minimal typing
- Reusable customer information
- Reusable common service information
- Automatic calculations
- Professional PDF output
- Reliable local storage

The user should not need technical knowledge to operate the application.

---

# 5. Company / Supplier Master

The application shall provide a company settings screen.

## 5.1 Company Information

Support:

- Company name
- Full address
- GSTIN/UIN
- State name
- State code
- Email
- Phone/mobile
- Logo

The sample Tally invoices contain supplier information such as company name, complete postal address, GSTIN, state/state code and email.

## 5.2 Bank Information

Support:

- Bank name
- Account number
- Branch name
- IFSC code

These fields are printed in the invoice footer.

## 5.3 Signature / Branding

Support:

- Company logo
- Authorized signatory name/text
- Optional signature/stamp image

The logo and signature/stamp are presentation elements and should be configurable locally.

---

# 6. Customer Master

The application shall allow customers to be created once and reused across invoices.

## 6.1 Customer Information

Support:

- Customer/company name
- GSTIN/UIN
- State name
- State code
- Phone
- Email

## 6.2 Billing Information

Support:

- Billing address
- Billing state

## 6.3 Shipping / Consignee Information

Support:

- Ship-to / consignee address
- Ship-to state
- Optional godown / warehouse address

The sample invoices distinguish between:

- Consignee (Ship to)
- Buyer (Bill to)

The application must preserve this distinction even when both addresses are identical.

---

# 7. Invoice Header

Every invoice shall support the following information.

## 7.1 Required / Core

- Tax Invoice title
- Invoice number
- Invoice date
- Buyer / customer
- At least one line item

## 7.2 Optional Reference Information

Support:

- Delivery Note number
- Delivery Note date
- Reference number
- Reference date
- Buyer's Order / PO number
- PO date
- Dispatch document number
- Dispatch date
- Bill of Lading / LR-RR number
- Motor Vehicle number
- Dispatched through
- Destination
- Terms of delivery
- Other references

The sample Tally invoices contain these fields, with some fields populated and some left blank.

## 7.3 Commercial Information

Support:

- Payment terms
- Due date
- Place of supply

The reference image additionally emphasizes place of supply and due date.

---

# 8. Invoice Numbering

Invoice numbers shall be generated locally.

Example format from the sample:

`SE/26-27/043`

Requirements:

- Configurable prefix
- Financial-year component
- Sequential numeric portion
- Automatic next-number generation
- Duplicate numbers must be prevented
- Finalized invoice numbers must not be casually reused

The number sequence should be stored locally.

Invoice numbering must not depend on a server.

---

# 9. Mould / Job Information

This is the most important domain-specific area.

The actual sample invoices contain machining information inside the service description.

Examples include:

- `DT-663`
- `PUNCH GUN DRILLING`
- `DRILL DIA 9X307MM DEEP`
- `QTY 16 NOS.`
- `6 SIDE MACHINING 510X430X130`
- `6 SIDE MACHINING 510X430X150`

The new application should improve this by allowing structured technical information rather than requiring everything to be entered into one long description.

## 9.1 Recommended Structured Fields

Support:

- Job / Mould number
- Component / Part number
- Operation / Process
- Service type
- Specification
- Dimensions
- Additional description

## 9.2 Technical Flexibility

Do not assume every mould job uses the same technical fields.

The user should be able to describe:

- Diameter
- Depth
- Length
- Width
- Height
- Size
- Other technical specifications

A general `Specification` or `Technical Details` field should remain available for information that does not fit fixed fields.

## 9.3 Important Rule

Structured mould fields are preferred, but a free-text description must always remain available.

---

# 10. Invoice Line Items

Each invoice must support one or more line items.

Each line item should support:

| Field | Requirement |
|---|---|
| Serial number | Automatic |
| Job / Mould reference | Optional but recommended |
| Operation / Process | Optional |
| Description | Required |
| Specification | Optional |
| HSN/SAC | Required for taxable service |
| Quantity | Required |
| Unit | Required |
| Rate | Required |
| Discount % | Optional |
| Taxable amount | Calculated |
| GST | Calculated |
| Amount | Calculated |

## 10.1 Units

The application should support arbitrary units such as:

- NOS
- MM
- PCS
- KG
- SET
- HOURS

The unit must be selectable per line item.

## 10.2 Multiple Operations

A single invoice must support multiple operations.

The BMSS STEEL invoice demonstrates two separate machining charges on the same invoice, each with its own description, quantity and rate.

---

# 11. HSN / SAC

Every taxable line item shall support HSN/SAC.

The sample machining service invoices use:

`998898`

for the service shown.

The application may provide a default HSN/SAC, but it must remain configurable.

Do not assume `998898` is universally applicable to every future service. The invoice system must allow the user to select/change the code.

---

# 12. Discount

The sample Tally layout contains a discount column.

The application shall support:

- Discount percentage
- Calculated discount amount
- Taxable value after discount

Discount is optional and defaults to zero.

---

# 13. GST / Tax Requirements

The application shall support GST calculations required by the invoice.

## 13.1 Intra-State

For an intra-state transaction:

- CGST
- SGST/UTGST where applicable

The sample invoices demonstrate:

- CGST: 9%
- SGST: 9%

on the shown 18% service charge.

## 13.2 Inter-State

For an inter-state transaction:

- IGST

The Tata reference demonstrates an invoice using:

- IGST: 18%

## 13.3 Tax Rate

Tax rate must be configurable rather than hardcoded permanently to 18%.

A default can be provided based on configured service settings.

## 13.4 Taxable Value

For each line:

`Taxable Value = Line Base Amount - Discount`

## 13.5 Tax Summary

The invoice should automatically produce an HSN/SAC-wise tax summary containing:

- HSN/SAC
- Taxable value
- CGST rate
- CGST amount
- SGST rate
- SGST amount
- IGST rate, when applicable
- IGST amount, when applicable
- Total tax amount

---

# 14. Monetary Calculation Rules

All money calculations must use exact decimal arithmetic.

Do not use binary floating-point values for monetary calculations.

Amounts should be represented to two decimal places.

The application must calculate:

1. Line base amount
2. Discount
3. Taxable amount
4. Applicable GST
5. Total tax
6. Pre-round total
7. Round-off adjustment
8. Grand total

The exact round-off behavior must reproduce the intended invoice total.

The two sample invoices provide useful golden test cases:

### Invoice 043

- Taxable value: ₹12,280.00
- CGST: ₹1,105.20
- SGST: ₹1,105.20
- Round off: -₹0.40
- Grand total: ₹14,490.00

### Invoice 089

- Taxable value: ₹8,332.00
- CGST: ₹749.88
- SGST: ₹749.88
- Round off: ₹0.24
- Grand total: ₹9,832.00

These values must be reproduced by automated calculation tests.

---

# 15. Amount in Words

The application shall automatically generate:

### Invoice Total in Words

Example:

`INR Fourteen Thousand Four Hundred Ninety Only`

### Tax Amount in Words

Example:

`INR Two Thousand Two Hundred Ten and Forty paise Only`

The generated text must always reflect the calculated invoice values.

---

# 16. Payment Information

This application does not process online payments.

It only displays payment information on the invoice and optionally records a local payment status.

## 16.1 Invoice Payment Details

Support:

- Payment terms
- Due date
- Bank details
- UPI ID
- Optional UPI QR code

## 16.2 Local Payment Status

Optional status:

- Unpaid
- Partially Paid
- Paid

Payment status is local application information and does not require online verification.

The Tata reference visually shows an `Amount Paid` indicator and a UPI QR code.

---

# 17. Notes

Allow an invoice-level Notes field.

Possible examples:

- Job notes
- Delivery notes
- Inspection notes
- Special instructions
- Customer-specific notes

Notes are optional.

---

# 18. Terms & Conditions

The application shall allow configurable default Terms & Conditions.

The Tata reference demonstrates terms such as:

- Conditions on sale/exchange
- Warranty terms
- Interest for delayed payment
- Jurisdiction

The user should be able to edit the default terms from Settings.

Invoice-level customization should also be possible where practical.

---

# 19. Declaration

The invoice should support a declaration section.

The sample Tally invoice uses a statement declaring that:

- The invoice reflects the actual price of the goods/services.
- The particulars are true and correct.

The declaration should be configurable but enabled by default.

---

# 20. Invoice Status / Lifecycle

Use a controlled invoice lifecycle.

## Draft

- Editable
- Can be deleted if necessary
- Does not represent a finalized tax invoice

## Finalized

- Invoice number is locked
- Values are locked
- PDF can be generated
- Can be printed/reprinted
- Should not be freely edited

## Cancelled

A finalized invoice should be cancellable rather than silently deleted.

The original record should remain available for audit/history.

## Paid

Payment status may independently be:

- Unpaid
- Partial
- Paid

Payment status must not replace invoice status.

---

# 21. Invoice History

Provide an invoice list screen.

Columns should include:

- Invoice number
- Date
- Customer
- Job/Mould reference
- Total amount
- Invoice status
- Payment status

Support:

- Search by invoice number
- Search by customer
- Date range filter
- Status filter
- Sort
- View
- Preview
- Print
- Export PDF
- Duplicate as new invoice

Do not permanently delete finalized invoices from normal user workflows.

---

# 22. Customer Reuse

Creating a new invoice should allow the user to select an existing customer.

On selection:

- Customer name fills automatically.
- GSTIN fills automatically.
- Billing address fills automatically.
- Shipping/consignee information fills automatically.
- State/state code fills automatically.

The user should not need to retype customer details for every invoice.

---

# 23. Product / Service Reuse

The application should optionally support reusable service descriptions.

For example:

- Gundrilling
- 6 Side Machining
- Other machining operations

This can be a lightweight local master/template feature.

Do not build a complete inventory or product-management module.

---

# 24. PDF Invoice Requirements

The invoice PDF is a primary deliverable.

The target format is:

- A4
- Professional
- Printer-friendly
- Readable in black-and-white printing
- Suitable for digital sharing
- Clear tax information
- Clear grand total
- Strong information hierarchy

## 24.1 Recommended Structure

### Header

- Company logo
- Company name
- Company address
- GSTIN
- Phone/email
- `TAX INVOICE`
- `ORIGINAL FOR RECIPIENT` where applicable

### Invoice Information

- Invoice number
- Invoice date
- Due date
- Place of supply
- Payment terms

### Customer Section

- Bill To
- Ship To / Consignee
- GSTIN
- Billing/shipping address

### Reference Section

- PO number/date
- Challan number/date
- Delivery note
- Vehicle number
- Dispatch information
- Destination
- Terms of delivery

### Mould / Machining Line Items

Use a structured table where practical:

- #
- Job/Mould
- Operation
- Description/Specification
- HSN/SAC
- Qty
- Unit
- Rate
- Discount
- Amount

Avoid unnecessarily wide columns that make the PDF unreadable.

### Tax Section

- HSN/SAC
- Taxable value
- CGST
- SGST
- IGST when applicable
- Total tax

### Totals

- Taxable amount
- Tax amount(s)
- Round off
- Grand total
- Amount in words
- Tax amount in words

### Payment Section

- Bank details
- UPI
- QR code if configured

### Footer

- Notes
- Terms & Conditions
- Declaration
- Authorized signatory
- Signature/stamp
- Computer-generated invoice statement
- Page number

---

# 25. Visual Design Direction

The Tally PDFs are information-dense and accounting-oriented.

The Tata reference has a stronger visual hierarchy.

The new design should combine the useful accounting information of Tally with the clarity of the reference image.

Prioritize:

- Clear section titles
- Consistent alignment
- Good whitespace
- Strong table headings
- Highly visible grand total
- Easy-to-read customer information
- Easy-to-read mould/job specifications
- Professional company branding
- Clear signature area
- Clear payment information

Do not over-design the invoice.

The result should look like a professional business invoice, not a marketing brochure.

---

# 26. Local Data Storage

All data must remain local.

Recommended storage:

- SQLite database
- Local application data directory
- Local PDF export directory
- Local backup directory

The database should contain:

- Company settings
- Customers
- Invoices
- Invoice line items
- Invoice numbering information
- Configurable defaults

No server is required.

---

# 27. Backup / Restore

Because all billing data is local, backup is a high-priority feature.

Support:

- Manual backup
- Manual restore
- Automatic local backup

Backups should preserve the SQLite database.

A restore operation must not silently overwrite existing data without confirmation.

Recommended backup characteristics:

- Timestamped files
- Multiple retained versions
- Clear backup location
- Restore confirmation
- Validation of backup before replacement

---

# 28. PDF File Management

The user shall be able to:

- Preview PDF
- Save/export PDF
- Choose output location
- Print PDF
- Reprint existing invoice
- Generate the same finalized invoice again without changing its values

Suggested default export naming:

`INV_SE_26-27_043.pdf`

or another deterministic filename based on the invoice number.

---

# 29. Desktop Screens

The minimum application should contain:

## Screen 1: Dashboard

Show:

- New Invoice
- Recent invoices
- Quick invoice search
- Basic totals/counts if useful

## Screen 2: Customers

- Customer list
- Search
- Add
- Edit
- View
- Duplicate

## Screen 3: Create/Edit Invoice

Sections:

- Customer
- Invoice details
- References
- Mould/job information
- Line items
- Taxes
- Totals
- Notes
- Terms

Actions:

- Save Draft
- Finalize
- Preview
- Print
- Export PDF
- Cancel

## Screen 4: Invoice History

- Search
- Filters
- View
- Print
- Export
- Duplicate
- Cancel finalized invoice where authorized

## Screen 5: Settings

- Company
- Bank
- Logo
- Signature/stamp
- Invoice numbering
- Default tax settings
- Default notes
- Default terms & conditions
- Backup / restore
- Export location

A separate PDF Preview window/dialog may be provided.

---

# 30. Validation Requirements

## Company

- Company name cannot be empty.
- GSTIN should be validated for format.
- State/state code should be consistent.
- Bank fields should be validated when entered.
- Email should be validated when entered.

## Customer

- Customer name required.
- Billing address required.
- GSTIN optional where appropriate, but format validated when entered.
- State information validated.

## Invoice

- Invoice number unique.
- Invoice date required.
- Due date cannot precede invoice date.
- At least one line item required before finalization.
- Grand total should be valid.
- Customer required.

## Line Item

- Description required.
- HSN/SAC required for taxable service lines.
- Quantity must be greater than zero.
- Rate must not be negative.
- Discount must be between 0 and 100.
- Applicable tax rates must be valid.

Validation errors should be shown close to the relevant field.

---

# 31. Error Handling

The application should handle clearly:

- Database unavailable/corrupted
- Failed save
- Duplicate invoice number
- PDF generation failure
- Printer failure
- Invalid file path
- Permission error
- Disk full
- Failed backup
- Invalid restore file

Errors should be understandable to a business user.

Do not expose raw stack traces in normal UI.

Detailed technical information may be written to a local log.

---

# 32. Logging

The application may maintain a local log file for troubleshooting.

The log should record:

- Application errors
- Database errors
- PDF errors
- Backup/restore failures

Do not log:

- Passwords
- Sensitive credentials
- Unnecessary personal data

Logging must remain local.

---

# 33. Keyboard / Usability Requirements

Support normal desktop keyboard navigation.

Useful shortcuts:

- `Ctrl+N` → New Invoice
- `Ctrl+S` → Save
- `Ctrl+P` → Print
- `Ctrl+F` → Search
- `Escape` → Cancel/close dialog
- `Tab` / `Shift+Tab` → Move between controls

Line-item entry should minimize mouse usage where practical.

---

# 34. Performance Expectations

The application is intended for a small-business local workload.

Target:

- Fast application startup
- Invoice form should open immediately
- Customer search should feel instant
- Invoice save should complete quickly
- PDF generation should normally complete within a few seconds
- Invoice history should remain responsive with thousands of invoices

Do not introduce complex infrastructure merely to achieve these targets.

---

# 35. Security / Offline Requirements

The application must:

- Make no cloud dependency
- Make no required network calls
- Store billing data locally
- Use parameterized database queries
- Protect against accidental data loss
- Maintain invoice history after finalization
- Provide local backup/restore

Internet access must not be required to create or print an invoice.

---

# 36. Accounting / Audit Principles

The application is a billing tool, not a complete accounting package.

However:

- Finalized invoices must have stable invoice numbers.
- Finalized invoice values should be preserved.
- Cancellation should preserve the original record.
- Reprints must not create a new invoice.
- Duplicating an invoice must create a new draft/new invoice number rather than modifying the original.
- Tax totals shown on the PDF must be reproducible from stored invoice data.

---

# 37. Sample Invoice Acceptance Tests

## Test Case A — DI-TECH MOULDS / Invoice 043

The system must be capable of representing:

- Customer: DI-TECH MOULDS
- Invoice: `SE/26-27/043`
- Date: `11-May-26`
- PO/challan references as shown
- Service: Gundrilling
- Job/reference: `DT-663`
- Operation: Punch Gun Drilling
- Specification: `DRILL DIA 9X307MM DEEP`
- Quantity: `16 NOS.`
- HSN/SAC: `998898`
- Taxable amount: ₹12,280.00
- CGST: ₹1,105.20
- SGST: ₹1,105.20
- Round off: -₹0.40
- Total: ₹14,490.00

## Test Case B — BMSS STEEL / Invoice 089

The system must be capable of representing:

- Customer: BMSS STEEL INDUSTRIES PRIVATE LIMITED
- Invoice: `SE/26-27/089`
- Date: `22-Jun-26`
- Payment terms: `30 Days`
- PO reference: `BMSS/L/070/26-27`
- Challan: `CHALLAN NO. 353`
- Vehicle: `MH48CQ5748`
- Two machining line items
- `6 SIDE MACHINING 510X430X130`
- `6 SIDE MACHINING 510X430X150`
- HSN/SAC: `998898`
- Taxable amount: ₹8,332.00
- CGST: ₹749.88
- SGST: ₹749.88
- Round off: ₹0.24
- Total: ₹9,832.00

These examples are acceptance references for functionality and calculations.

---

# 38. Priority Classification

## P0 — Must Have

### Invoice
- Company details
- Customer details
- Invoice number
- Invoice date
- Customer selection
- At least one line item
- Description
- HSN/SAC
- Quantity
- Unit
- Rate
- Taxable amount
- GST calculation
- CGST/SGST
- IGST
- Round off
- Grand total
- Amount in words
- Invoice PDF
- A4 layout
- Local save
- Invoice history
- Print
- PDF export

### Mould/Machining
- Job/mould reference
- Operation/process
- Specification/technical description
- Multiple line items

### Data
- Local SQLite or equivalent local relational storage
- Backup
- Restore

## P1 — Important

- Due date
- Payment terms
- PO/challan information
- Vehicle number
- Ship-to/consignee
- Godown address
- Bank details
- UPI/QR
- Payment status
- Notes
- Terms & Conditions
- Declaration
- Logo
- Signature/stamp
- Search/filter
- Duplicate invoice
- Cancel finalized invoice
- Invoice preview

## P2 — Optional

- Service templates
- CSV customer import
- Excel export
- Multiple companies
- Multiple invoice templates
- Multi-language support
- Dark mode
- Advanced payment tracking
- Recurring invoices
- Email integration

---

# 39. Recommended Product Boundaries

Version 1 should answer one question well:

> "Can a business operator quickly create a correct professional mould/machining tax invoice and print or save it as PDF?"

Anything that does not materially improve that workflow should be deferred.

Do not turn this application into an ERP.

---

# 40. Definition of Done

The product is ready for Version 1 when:

- Company details can be configured.
- Customer details can be saved and reused.
- A mould/machining invoice can be created.
- Multiple line items can be entered.
- GST is calculated correctly.
- The sample invoice calculation cases pass.
- Invoice numbers are unique and sequential.
- Draft/finalized/cancelled behavior works.
- Finalized invoices cannot be casually overwritten.
- PDF is generated in A4 format.
- PDF contains all required customer, mould, tax and total information.
- Amounts in words are correct.
- Bank/payment/signature sections render correctly.
- Invoice can be printed locally.
- Invoice can be exported to PDF.
- Existing invoices can be searched and reprinted.
- Data survives application restart.
- Backup and restore work.
- Application works without internet access.
- No cloud/server dependency exists.

---

# 41. Implementation Constraint

This document intentionally describes **WHAT the product must do**, not detailed implementation.

Technology choices, class design, database normalization, UI framework decisions, packaging, testing architecture and PDF implementation should be defined separately in:

- `ARCHITECTURE.md`
- `INVOICE_RULES.md`
- `PDF_LAYOUT.md`
- Kiro specification/task files

The product requirements must remain the source of truth for functionality.

---

# 42. Source-Based Notes

The Tally invoices demonstrate:

- Supplier and customer/consignee information
- GSTIN/state details
- Invoice and reference fields
- Mould/machining service descriptions
- HSN/SAC `998898`
- Quantities and units such as MM/NOS
- CGST 9% + SGST 9%
- Round-off
- Amount in words
- Tax amount in words
- Declaration
- Bank details
- Authorized signatory

The Tata Motors reference adds useful presentation patterns such as:

- Stronger company branding
- Tax Invoice / Original for Recipient labeling
- Place of supply
- Due date
- Prominent shipping address
- UPI QR code
- Payment status
- Notes
- Terms & Conditions
- Large, visually prominent total
- More polished visual hierarchy

These source observations should guide the final PDF design without blindly copying the Tata branding or unrelated automotive content.
