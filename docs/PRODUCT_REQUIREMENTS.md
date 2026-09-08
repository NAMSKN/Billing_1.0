# PRODUCT REQUIREMENTS

## Local Desktop Billing Application for Mould / Mould-Machining Business

**Document Version:** 2.0  
**Status:** Revised Requirements Baseline  
**Scope:** Local desktop billing and invoice generation only  
**Primary Platform:** Windows  
**Primary Output:** Professional GST tax invoice PDF suitable for printing and sharing  
**Offline Requirement:** Core application works without internet access

---

# 1. Product Purpose

Build a simple, reliable **desktop billing application** for a mould / mould-machining business in India.

The application exists primarily to help a billing operator:

```text
Select Customer
      ↓
Enter Mould / Job / Machining Work
      ↓
Enter Quantity and Rate
      ↓
Review GST and Total
      ↓
Finalize Invoice
      ↓
Generate PDF
      ↓
Print / Export
```

The product is intentionally focused on billing.

It is **not** intended to become an ERP, CRM, manufacturing management system, inventory platform, accounting package, or cloud service.

---

# 2. Product Principles

The application must prioritize:

1. Financial correctness.
2. Stable invoice history.
3. Fast day-to-day invoice entry.
4. Clear mould/machining information.
5. Professional PDF output.
6. Reliable local data storage.
7. Safe backup and restore.
8. Offline operation.
9. Simple operation for non-technical users.

When simplicity and additional features conflict, prefer simplicity.

---

# 3. Source Documents

The product requirements are based on:

1. `INV NO 043 DI-TECH MOULDS.pdf`
2. `INV NO 089 BMSS STEEL.pdf`
3. Tata Motors tax invoice reference image

The two Tally invoices are the primary source for actual billing fields and mould/machining information.

The Tata reference is primarily a visual reference for a cleaner presentation.

The reference branding, automotive content and unrelated business-specific information must not be copied into the product.

---

# 4. Product Scope

## 4.1 Version 1 — In Scope

### Core Billing

- Company configuration
- Customer management
- Invoice creation
- Draft invoice saving
- Draft invoice editing
- Invoice finalization
- Invoice cancellation
- Invoice duplication
- Invoice numbering
- Invoice history
- Invoice search
- Invoice filtering
- Invoice preview
- PDF generation
- PDF export
- Local printing

### Mould / Machining Billing

- Job / mould reference
- Component / part reference
- Operation / process
- Service type
- Description
- Specification
- Dimensions
- Quantity
- Unit
- Rate
- Discount
- HSN/SAC

### Tax

- Taxable value
- CGST
- SGST
- IGST
- Configurable tax rates
- HSN/SAC tax summary
- Round-off
- Grand total
- Amount in words
- Tax amount in words

### Payment Information

- Payment terms
- Due date
- Bank details
- UPI ID
- Optional UPI QR
- Local payment status

### Documents

- Notes
- Terms & Conditions
- Declaration
- Authorized signatory
- Signature/stamp
- Company logo
- Page numbering

### Data Protection

- Local persistence
- Local backup
- Local restore
- Historical invoice preservation

---

# 5. Explicitly Out of Scope

Do not implement the following in Version 1:

- Cloud storage
- Cloud synchronization
- REST APIs
- Backend server
- Remote database
- SaaS architecture
- Multi-tenant architecture
- Online customer portal
- Online payment gateway
- Mandatory user accounts
- Online GSTIN verification
- Email delivery service
- Kafka
- Redis
- Message queues
- Microservices
- Payroll
- CRM
- Purchase management
- Manufacturing planning
- IoT integration
- Full inventory management
- Full accounting ledger
- Multi-user synchronization
- Automatic online software updates

If any future feature requires internet access, it must be explicitly approved as a separate scope change.

---

# 6. Primary User

The primary user is a business billing operator.

The user should be able to create an invoice without technical knowledge.

The interface should optimize for:

- Minimal typing
- Reuse of customer information
- Quick line-item entry
- Keyboard-friendly navigation
- Clear calculations
- Immediate PDF preview
- Fast printing

---

# 7. Company Master

The application shall support one active company in Version 1.

## 7.1 Company Details

Support:

- Company name
- Full address
- GSTIN/UIN
- State name
- State code
- Phone/mobile
- Email
- Logo

## 7.2 Bank Details

Support:

- Bank name
- Account number
- Branch
- IFSC

## 7.3 Payment Details

Support:

- UPI ID
- Optional QR configuration

## 7.4 Document Branding

Support:

- Logo
- Authorized signatory name
- Signature/stamp image
- Default declaration
- Default notes
- Default Terms & Conditions

Changes to company settings must not modify the content of previously finalized invoices.

---

# 8. Customer Master

Customers should be created once and reused.

## 8.1 Customer Details

Support:

- Customer/company name
- GSTIN/UIN
- State name
- State code
- Phone
- Email

## 8.2 Bill-To Details

Support:

- Billing address
- Billing state
- Billing state code

## 8.3 Ship-To / Consignee Details

Support:

- Consignee name
- Shipping address
- Shipping state
- Shipping state code
- Optional godown / warehouse address

The application must support Bill-To and Ship-To being different.

The application should also support them being identical.

## 8.4 Customer Lifecycle

Customers can be:

```text
Active
Inactive
```

Inactive customers remain available for historical invoices but should not normally appear in new invoice selection.

Customer deletion should therefore be archival rather than destructive when historical invoices depend on that customer.

---

# 9. Invoice Creation

A new invoice starts as a **Draft**.

A draft is editable and may be incomplete.

A draft must be saveable before it is complete.

Examples of incomplete draft states:

- No customer selected yet.
- Line item partially entered.
- Optional references missing.
- Some values still being edited.

The application must not reject the entire draft merely because it is not yet ready for finalization.

---

# 10. Draft Input Rules

Draft input must preserve what the user has actually entered.

Examples:

```text
Customer selected
Description entered
Quantity entered
Rate not yet entered
```

must remain a valid draft state.

However:

- malformed numeric input must not silently become zero;
- invalid final values must prevent finalization;
- incomplete fields must be reported clearly.

Draft validation and finalization validation are different stages.

---

# 11. Invoice Header

Each invoice supports:

## Required for Finalization

- Tax Invoice title
- Invoice number
- Invoice date
- Customer
- At least one valid line item

## Optional Reference Information

- Delivery Note number
- Delivery Note date
- Reference number
- Reference date
- Buyer's Order / PO number
- PO date
- Dispatch Document number
- Dispatch date
- Bill of Lading / LR-RR number
- Motor Vehicle number
- Dispatched through
- Destination
- Terms of delivery
- Other references

## Commercial Information

- Payment terms
- Due date
- Place of supply

Optional fields should not produce awkward empty labels in the PDF.

---

# 12. Invoice Numbering

Invoice numbers are generated locally.

Example:

```text
SE/26-27/043
```

Support:

- Configurable prefix
- Financial year
- Sequential number
- Optional configurable zero-padding

Rules:

1. Finalized invoice numbers must be unique.
2. Finalized invoice numbers must never be reused.
3. Cancellation does not release a number.
4. Duplicating an invoice does not reuse its number.
5. Invoice numbering must work independently for each financial year.
6. Initial sequence must be configurable for businesses migrating from an existing billing system.
7. Backdated invoices must use the financial-year rules associated with their invoice date.
8. Sequence reservation must be safe against duplicate issuance.

The system must not assume the next number is `090` merely because a sample invoice ends in `089`.

---

# 13. Financial Year

The application must use a defined financial-year rule.

The behavior around:

```text
31 March
1 April
```

must be deterministic.

The system must support:

- Normal current-year invoices
- Backdated invoices
- Financial-year rollover
- Existing sequence initialization
- Prefix changes according to configured policy

The exact business policy for backdated invoice numbering must be documented before final implementation.

---

# 14. Mould / Job Information

Mould and machining information is the primary domain-specific requirement.

The actual invoices include information such as:

```text
DT-663
PUNCH GUN DRILLING
DRILL DIA 9X307MM DEEP
QTY 16 NOS.
```

and:

```text
6 SIDE MACHINING 510X430X130
6 SIDE MACHINING 510X430X150
```

The new application must preserve this information while improving its structure.

---

# 15. Structured Mould / Machining Fields

A line item should support:

- Job / mould number
- Component / part number
- Operation / process
- Service type
- Description
- Specification
- Dimensions
- Additional technical details

The system should allow information such as:

- Diameter
- Depth
- Length
- Width
- Height
- Size

but must not force every job into identical technical fields.

The general Specification / Technical Details field remains available.

---

# 16. Line Items

An invoice must contain one or more line items before finalization.

Each line item supports:

| Field | Required |
|---|---|
| Sequence | Automatic |
| Job / Mould reference | Optional |
| Component / Part | Optional |
| Operation / Process | Optional |
| Service type | Optional |
| Description | Required for finalization |
| Specification | Optional |
| HSN/SAC | Required for taxable line |
| Quantity | Required for normal billable line |
| Unit | Required |
| Rate | Required |
| Discount % | Optional |
| Tax rate | Required according to tax treatment |
| Taxable amount | Calculated |
| Tax | Calculated |
| Amount | Calculated |

The description remains flexible even when structured technical fields are populated.

---

# 17. Units

The application supports units such as:

- NOS
- MM
- PCS
- KG
- SET
- HOURS

The unit list may be configurable.

Quantity precision must be independent from money precision.

For example:

```text
Quantity = 12.500
```

must not be incorrectly reduced to:

```text
12.50
```

merely because monetary values use two decimals.

---

# 18. Line Item Calculation

For a normal line:

```text
Gross Amount = Quantity × Rate
```

Then:

```text
Discount Amount = Gross Amount × Discount % / 100
```

Then:

```text
Taxable Amount = Gross Amount − Discount Amount
```

All financial calculations must use exact decimal arithmetic.

No monetary calculation may rely on binary floating-point arithmetic.

---

# 19. Discount

Discount is optional and defaults to:

```text
0%
```

Rules:

- Minimum: 0%
- Maximum: 100%
- Discount is applied before GST.
- Discount amount is calculated automatically.
- Taxable amount reflects the discount.

---

# 20. HSN / SAC

Every taxable service line must support HSN/SAC.

The sample invoices use:

```text
998898
```

The application may provide this as a configurable default.

It must not be treated as the universal code for every future service.

Multiple HSN/SAC codes may be used on one invoice.

---

# 21. GST / Tax

The application supports normal domestic taxable transactions.

## 21.1 Intra-State

Use:

```text
CGST + SGST/UTGST where applicable
```

The sample invoices demonstrate:

```text
CGST 9%
SGST 9%
```

for an 18% service charge.

## 21.2 Inter-State

Use:

```text
IGST
```

The reference invoice demonstrates 18% IGST.

## 21.3 Tax Rates

Tax rates must be configurable.

The application must not permanently hardcode:

```text
9% + 9%
```

or:

```text
18%
```

as the only supported rate.

---

# 22. Place of Supply

Place of supply is an explicit invoice field.

For the supported normal domestic workflow:

```text
Company State
      +
Place of Supply
      ↓
Tax Treatment
```

The application must not ambiguously switch between "customer state" and "place of supply" as tax authority.

When Bill-To and Ship-To differ, the documented place-of-supply field remains the authoritative value for tax determination within the supported product scope.

The exact supported business cases must be documented before production use.

---

# 23. GST Special-Case Scope

Version 1 should explicitly support only the normal taxable flow unless the business approves additional cases.

### Supported

- Normal intra-state taxable supply
- Normal inter-state taxable supply
- Configurable tax rates

### Not silently supported

- Reverse charge
- Exempt supply
- Nil-rated supply
- Zero-rated supply
- Export
- SEZ
- Other special GST treatments

A special case must not be silently represented as a normal 0% tax line.

---

# 24. Tax Calculation

For an applicable line:

```text
CGST Amount = Taxable Amount × CGST Rate / 100
SGST Amount = Taxable Amount × SGST Rate / 100
IGST Amount = Taxable Amount × IGST Rate / 100
```

A normal line must not calculate both:

```text
CGST + SGST
```

and:

```text
IGST
```

at the same time.

The application must determine the applicable tax treatment before calculating tax.

---

# 25. Tax Summary

The tax summary is derived from line items.

The grouping key must be:

```text
HSN/SAC
+
Tax Treatment
+
Applicable Tax Rate(s)
```

not HSN/SAC alone.

The tax summary should contain:

- HSN/SAC
- Taxable value
- CGST rate/amount where applicable
- SGST rate/amount where applicable
- IGST rate/amount where applicable
- Total tax

The summary must reconcile exactly with line-level calculated values.

The summary must not independently recalculate tax from an aggregated taxable value.

---

# 26. Money Precision

All monetary values use exact decimal arithmetic.

Money includes:

- Rate
- Discount amount
- Taxable amount
- CGST
- SGST
- IGST
- Round-off
- Grand total
- Payment amounts where supported

Reject:

- NaN
- Infinity
- Invalid decimal input

Quantity and monetary precision are separate concepts.

The application must preserve values through:

```text
UI
→ Domain
→ Database
→ PDF
```

without changing digits.

---

# 27. Money Storage

The implementation must use an exact persistence representation.

The database must not rely on floating-point storage for money.

A preferred strategy is:

```text
Money in SQLite = integer paise
```

Example:

```text
₹123.45 → 12345
```

Other decimal fields such as quantity and percentage may use an exact canonical representation.

The final implementation must document the serialization format and round-trip tests.

---

# 28. Round-Off

The application must calculate round-off explicitly.

Conceptually:

```text
Raw Total
    ↓
Rounded Total
    ↓
Round-Off = Rounded Total − Raw Total
```

Then:

```text
Grand Total = Raw Total + Round-Off
```

Round-off may be positive or negative.

The rounding policy must be centralized and tested.

The documented sample invoices must be reproducible:

### Invoice 043

```text
Taxable       ₹12,280.00
CGST           ₹1,105.20
SGST           ₹1,105.20
Before Round  ₹14,490.40
Round-Off        -₹0.40
Grand Total   ₹14,490.00
```

### Invoice 089

```text
Taxable        ₹8,332.00
CGST             ₹749.88
SGST             ₹749.88
Before Round   ₹9,831.76
Round-Off         ₹0.24
Grand Total    ₹9,832.00
```

These are aggregate regression values. Complete line-level reproduction should only be claimed when the original source inputs are available.

---

# 29. Amount in Words

The application automatically generates:

- Grand total in words
- Total tax in words

Example:

```text
INR Fourteen Thousand Four Hundred Ninety Only
```

Paise must be represented where applicable.

The words must always be derived from the final calculated values.

---

# 30. Invoice Lifecycle

Use explicit invoice states:

```text
DRAFT
   ↓
FINALIZED
   ↓
CANCELLED
```

Payment status is separate:

```text
UNPAID
PARTIAL
PAID
```

---

# 31. Draft Rules

A draft:

- Can be created.
- Can be incomplete.
- Can be saved.
- Can be reopened.
- Can be edited.
- Can be deleted.
- Does not represent a finalized invoice.
- Does not consume an official finalized invoice number.

The application may use an internal draft ID.

---

# 32. Finalization Rules

Finalization is the point at which an invoice becomes an official local billing record.

Before finalization:

1. Validate company details.
2. Validate customer.
3. Validate invoice date.
4. Validate place of supply/tax treatment.
5. Validate line items.
6. Validate HSN/SAC where required.
7. Validate quantity.
8. Validate rate.
9. Validate discount.
10. Calculate taxes.
11. Calculate totals.
12. Generate/reserve official invoice number.
13. Create invoice snapshots.
14. Persist atomically.

If any step fails:

```text
No finalized invoice
No partial database state
No unusable sequence update
```

---

# 33. Finalized Invoice Immutability

After finalization, the following cannot be freely edited:

- Invoice number
- Invoice date
- Company invoice snapshot
- Customer invoice snapshot
- Bill-To
- Ship-To
- Place of supply
- References
- Line items
- HSN/SAC
- Quantity
- Rate
- Discount
- Tax rates
- Calculated taxes
- Tax summary
- Round-off
- Grand total
- Notes
- Terms
- Declaration
- Payment details printed on the invoice
- Template version
- Asset versions

Allowed operations:

- View
- Preview
- Print
- Export
- Reprint
- Change payment status
- Cancel
- Duplicate into a new draft

---

# 34. Historical Invoice Snapshot

Finalized invoices must preserve the values used to produce the invoice.

The snapshot must include:

### Company

- Name
- Address
- GSTIN
- State
- State code
- Phone/email
- Bank details
- UPI details

### Customer

- Name
- GSTIN
- Billing address
- Shipping/consignee address
- State
- Contact details

### Invoice

- Number
- Date
- Due date
- Place of supply
- Payment terms
- References
- Notes
- Terms
- Declaration

### Lines

- Job/mould reference
- Component/part
- Operation
- Service type
- Description
- Specification
- HSN/SAC
- Quantity
- Unit
- Rate
- Discount
- Tax rates
- Calculated amounts

Historical invoices must not change because a master record is edited later.

---

# 35. Template and Asset Versioning

Finalized invoices must preserve the presentation configuration required to reproduce them.

Store/reference:

- Template version
- Logo version
- Signature/stamp version
- Other invoice assets used

Changing the company's logo or signature later must not silently change an old invoice.

Assets should be versioned locally.

The application may store them outside SQLite, but the required historical versions must remain recoverable through backup.

---

# 36. Invoice Cancellation

A finalized invoice must not be hard-deleted.

Cancellation should preserve:

- Invoice record
- Invoice number
- Original financial values
- Original snapshots

Record:

- Cancellation timestamp
- Cancellation reason

Optionally record:

- Replacement invoice reference

The UI must distinguish:

```text
Discard Draft
```

from:

```text
Cancel Finalized Invoice
```

The application must not claim that local cancellation updates external GST filings or government systems.

---

# 37. Invoice Duplication

Duplicating an invoice creates:

```text
Existing Invoice
       ↓
New Draft
```

Do not copy:

- Original ID
- Final invoice number
- Finalized state
- Payment status
- Final calculated totals as authoritative values

The duplicate should recalculate when finalized.

Fields copied to the new draft should follow a defined product policy for:

- Customer
- Technical information
- Payment terms
- References
- Dates
- Notes
- Terms

---

# 38. Payment Status

Payment status is local application information.

Supported:

```text
UNPAID
PARTIAL
PAID
```

Changing payment status must not alter:

- Invoice number
- Invoice date
- Line items
- Taxes
- Grand total

Version 1 does not provide a full receipts ledger.

Do not claim an authoritative outstanding balance from a simple `PARTIAL` flag.

---

# 39. Payment Information on Invoice

The PDF may display:

- Payment terms
- Due date
- Bank name
- Account number
- Branch
- IFSC
- UPI ID
- Optional UPI QR
- Payment status

The UPI QR is informational/payment convenience only.

No online payment gateway is required.

---

# 40. Notes

Support invoice-level notes.

Possible content:

- Job notes
- Delivery notes
- Inspection notes
- Special instructions

Notes must become part of the finalized invoice snapshot.

---

# 41. Terms & Conditions

Support configurable default Terms & Conditions.

Defaults may be edited from Settings.

When a draft is finalized, the actual terms used for that invoice must be preserved.

Changing the default terms later must not modify historical invoices.

---

# 42. Declaration

Support an editable declaration.

A default declaration may be enabled.

The finalized invoice must preserve the declaration actually used.

---

# 43. Invoice History

Provide an invoice history screen.

Show at least:

- Invoice number
- Date
- Customer
- Job/mould reference
- Grand total
- Invoice status
- Payment status

Support:

- Search by invoice number
- Search by customer
- Date range
- Invoice status filter
- Payment status filter
- Sort
- View
- Preview
- Print
- Export PDF
- Duplicate
- Cancel where permitted

The history list should not load every line item unless required.

---

# 44. Customer Reuse

Selecting an existing customer should populate:

- Customer name
- GSTIN
- Billing address
- Shipping/consignee details
- State information
- Contact information

The user should not re-enter the same details for every invoice.

A finalized invoice must preserve its own snapshot.

---

# 45. Service / Job Reuse

A lightweight reusable-service feature may be supported later.

Examples:

- Gundrilling
- 6 Side Machining
- Other machining operations

This is a P2 feature.

It must not evolve into a full inventory/product-management system.

---

# 46. PDF Requirements

The invoice PDF is a core product output.

The PDF must be:

- A4
- Professional
- Readable
- Printer-friendly
- Suitable for black-and-white printing
- Suitable for digital sharing
- Technically clear

The layout should combine:

```text
Tally's useful accounting information
+
Cleaner modern hierarchy
+
Mould/machining technical readability
```

---

# 47. PDF Structure

Recommended order:

```text
1. Header / Company Branding
2. Tax Invoice / Original for Recipient
3. Invoice Metadata
4. Bill To / Ship To
5. Reference / Logistics Details
6. Mould / Machining Line Items
7. Tax Summary
8. Totals
9. Amount in Words
10. Bank / Payment / UPI
11. Notes
12. Terms & Conditions
13. Declaration
14. Authorized Signatory
15. Footer / Page Number
```

---

# 48. PDF Optional Field Behavior

Empty optional information should generally be omitted.

Do not produce clutter such as:

```text
PO No.:
PO Date:
Vehicle No.:
```

when those values are not supplied.

The PDF should reorganize available information cleanly without leaving awkward empty areas.

---

# 49. PDF Line-Item Layout

Recommended columns:

```text
#
JOB / MOULD
OPERATION
DESCRIPTION / SPECIFICATION
HSN/SAC
QTY
UNIT
RATE
DISCOUNT
AMOUNT
```

The exact column combination may be adjusted for A4 width.

The final layout must prioritize:

1. Technical/job information
2. Quantity
3. Rate
4. Amount

Long technical descriptions must wrap without clipping.

---

# 50. PDF Typography

Use a professional, readable font hierarchy.

Recommended starting sizes:

- Body: approximately 8–9 pt
- Table headings: approximately 8–9 pt bold
- Larger headings: according to available space

The final implementation must use fonts supporting required characters such as:

```text
₹
×
```

and normal customer/company text.

---

# 51. PDF Text Safety

User-controlled text may contain:

```text
&
<
>
```

The PDF renderer must safely escape/encode such content before inserting it into markup.

Long:

- Company names
- Customer names
- Addresses
- Job numbers
- Technical descriptions
- Terms

must not cause clipping or rendering failures.

---

# 52. PDF Pagination

For invoices spanning multiple pages:

- Repeat the line-item table heading.
- Preserve row readability.
- Avoid splitting a row where practical.
- Continue long technical descriptions safely.
- Keep totals together where possible.
- Keep signature/declaration on the final page.
- Show page numbering.

There must be a fallback for oversized content that cannot fit naturally on one page.

---

# 53. PDF Preview / Export / Print Consistency

Preview, export and print must use the same generated PDF.

The flow is:

```text
Finalized Invoice
       ↓
PDF Generation
       ↓
One PDF
   ┌───┼────┐
   ↓   ↓    ↓
Preview Export Print
```

There must not be separate calculation or layout implementations for preview and print.

---

# 54. PDF Historical Rendering

A finalized invoice must remain reproducible from its stored invoice data and versioned presentation assets.

The product must not rely on today's customer/company settings to recreate an old invoice.

A future template change must not modify stored financial/party data.

---

# 55. Local Storage

All business data is local.

Store locally:

- Company configuration
- Customers
- Invoices
- Invoice line items
- Invoice sequences
- Application settings
- Versioned assets
- PDF exports
- Backups
- Logs

No server is required.

---

# 56. Backup

Backup is a high-priority product feature.

Support:

- Manual backup
- Manual restore
- Optional automatic backup

Backups should contain the information needed to recover the billing application, including:

- Database
- Schema/application version
- Required invoice assets
- Backup manifest

A backup must be validated before being considered usable.

---

# 57. Restore

Restore must be safe.

The process should be:

```text
Select Backup
     ↓
Validate Backup
     ↓
Validate Schema
     ↓
Validate Database Integrity
     ↓
Validate Required Assets
     ↓
Create Safety Backup of Current Data
     ↓
Close/coordinate database access
     ↓
Restore
     ↓
Reload Application
```

A failed restore must not leave the user without a recoverable database.

---

# 58. Restore and Invoice Number Safety

Restoring an older backup can restore an older invoice sequence.

The application must not silently reuse invoice numbers that may have been issued after that backup.

When necessary, restore must enter a reconciliation state requiring confirmation of the current sequence high-water mark before issuing a new invoice.

Important limitation:

> Number reconciliation can prevent reuse, but it cannot recover invoice records that do not exist in the restored backup.

---

# 59. Backup Retention

The backup system should support multiple retained backups.

Retention policy should:

- Keep more than one recovery point.
- Never delete the last known valid backup after a failed backup.
- Allow the user to understand which backup is being restored.

The exact retention period is configurable.

---

# 60. Application Screens

Version 1 should provide:

## Dashboard

- New Invoice
- Recent invoices
- Quick search
- Basic counts

## Customers

- List
- Search
- Add
- Edit
- View
- Archive/inactivate

## Create / Edit Invoice

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
- Close

## Invoice History

- Search
- Filters
- View
- Preview
- Print
- Export
- Duplicate
- Cancel where permitted

## Settings

- Company
- Bank
- UPI
- Logo
- Signature/stamp
- Invoice numbering
- Default tax settings
- Default payment terms
- Default notes
- Default terms
- Declaration
- Backup/restore
- Export location

---

# 61. Invoice UI State

The user interface must clearly distinguish:

### Draft

Editable.

### Finalized

Read-only billing information.

### Cancelled

Read-only historical record with cancellation status.

### Payment Status

Independent of the invoice lifecycle.

The UI must not show destructive or editing actions where they are not valid.

---

# 62. Unsaved Changes

When the user attempts to close an edited draft with unsaved changes, offer:

```text
Save
Discard
Cancel
```

Do not confuse closing a draft with cancelling a finalized invoice.

---

# 63. Validation

## Company

Validate:

- Required company name
- GSTIN format
- Valid state/state code
- Email format when supplied
- Bank information when supplied
- IFSC format when supplied

## Customer

Validate:

- Name
- Billing address
- State information
- GSTIN format when supplied
- Contact information when supplied

## Draft

Draft validation should allow incomplete entry.

## Finalization

Finalization requires:

- Valid customer
- Valid invoice date
- Valid place of supply/tax treatment
- At least one valid billable line
- Valid quantity
- Valid rate
- Valid discount
- Valid HSN/SAC where required
- Valid tax configuration

---

# 64. Error Handling

The application must provide clear messages for:

- Invalid fields
- Duplicate invoice number
- Database failure
- PDF generation failure
- Printer failure
- Export failure
- Backup failure
- Restore failure
- Missing asset
- Disk full
- Permission errors

Do not show raw stack traces to normal users.

Technical details may be written to the local log.

---

# 65. Offline Operation

The following must work without internet:

- Company setup
- Customer management
- Draft creation
- Invoice finalization
- GST calculation
- PDF generation
- Preview
- Export
- Printing
- Invoice search
- Backup
- Restore

No runtime API call may be required for the core billing workflow.

---

# 66. Data Integrity

The application must protect against:

- Partial finalization
- Duplicate invoice numbers
- Accidental deletion of finalized records
- Silent changes to historical invoices
- Failed database writes
- Invalid restore
- Asset loss
- Corrupt backups

Invoice finalization must be atomic.

---

# 67. Transactional Finalization

Finalization must behave as one logical transaction.

Conceptually:

```text
BEGIN
  Validate
  Determine tax
  Calculate
  Reserve sequence
  Create snapshots
  Save invoice
  Save line items
COMMIT
```

On failure:

```text
ROLLBACK
```

Repositories must participate in the same transaction and must not independently commit pieces of the finalization.

---

# 68. Repeated Finalization

The application must safely handle accidental repeated finalization.

Example:

```text
User clicks Finalize
       ↓
Successful
       ↓
User clicks Finalize again
```

The second attempt must not:

- issue another invoice;
- reserve another sequence;
- duplicate line items.

It should return the already-finalized result or a clear "already finalized" response.

---

# 69. Second Application Instance

The application is designed for single-user/single-computer operation.

If the user accidentally launches a second instance, the application must behave safely.

At minimum:

- Prevent conflicting database writes.
- Prevent duplicate sequence issuance.
- Provide a clear message when another instance is using the database, if required by the implementation.

Do not claim multi-user support.

---

# 70. Search and Sorting

Search should support:

- Invoice number
- Customer name

Filters should support:

- Date range
- Invoice status
- Payment status

Sortable columns should be explicitly controlled rather than allowing arbitrary user input to become SQL.

---

# 71. Keyboard Usability

Useful shortcuts:

```text
Ctrl+N  New Invoice
Ctrl+S  Save
Ctrl+P  Print
Ctrl+F  Search
Escape  Close/Cancel
Tab     Next field
Shift+Tab Previous field
```

Exact shortcuts may be adjusted for platform conventions.

---

# 72. Performance Expectations

The application is intended for local small-business usage.

Target:

- Fast startup
- Responsive invoice entry
- Near-instant customer search
- Responsive invoice history
- PDF generation within a few seconds for normal invoices

Do not introduce distributed infrastructure to meet these targets.

---

# 73. Primary Platform

Version 1 should prioritize:

```text
Windows
```

Windows acceptance must cover:

- Installation
- Startup
- Database creation
- Customer management
- Invoice creation
- Finalization
- PDF generation
- Preview
- Printing
- Export
- Backup
- Restore
- Offline operation

Cross-platform support may be added later if actually required.

---

# 74. Source Invoice Regression Tests

The following values must be represented in automated regression tests.

## Invoice 043

```text
Invoice Number : SE/26-27/043
Customer       : DI-TECH MOULDS

Taxable        : ₹12,280.00
CGST           : ₹1,105.20
SGST           : ₹1,105.20
Before Round   : ₹14,490.40
Round-Off      : -₹0.40
Grand Total    : ₹14,490.00
```

## Invoice 089

```text
Invoice Number : SE/26-27/089
Customer       : BMSS STEEL INDUSTRIES PRIVATE LIMITED

Taxable        : ₹8,332.00
CGST           : ₹749.88
SGST           : ₹749.88
Before Round   : ₹9,831.76
Round-Off      : ₹0.24
Grand Total    : ₹9,832.00
```

These aggregate figures are authoritative regression values for the supplied requirements.

The application must not invent missing source quantities/rates and claim complete original-invoice reproduction.

---

# 75. Acceptance Scenarios

The following are mandatory end-to-end behaviors.

## Scenario 1 — Incomplete Draft

```text
Create draft
→ enter partial information
→ save
→ close
→ reopen
```

Expected:

- Entered data remains.
- Draft remains editable.
- No official invoice number is consumed.

## Scenario 2 — Invalid Finalization

```text
Draft
→ Finalize
```

Expected:

- Field-specific errors.
- No finalized invoice.
- No partial sequence/database changes.

## Scenario 3 — Repeat Finalization

Expected:

- One invoice.
- One invoice number.
- No duplicate line items.

## Scenario 4 — Different Drafts

Finalizing two different drafts must produce different invoice numbers.

## Scenario 5 — Tax Rate Difference

Same HSN/SAC with different tax rates must produce separate summary rows.

## Scenario 6 — Bill-To vs Ship-To

Different addresses must both survive in the finalized invoice.

## Scenario 7 — Master Data Changed

After finalization, changing:

- customer address;
- bank details;
- company logo;
- UPI;
- terms;

must not silently change the historical invoice snapshot.

## Scenario 8 — Duplicate Paid Invoice

Expected:

```text
New draft
New identity
No final number
Payment status = Unpaid
```

## Scenario 9 — Cancellation

Expected:

- Original invoice retained.
- Number retained.
- Cancellation reason/time recorded.
- Cancelled status displayed.

## Scenario 10 — Old Backup Restore

Expected:

- Older invoice numbers are not silently reused.
- User is asked to reconcile the sequence when necessary.

## Scenario 11 — Export Failure

Expected:

- Clear error.
- Original invoice remains unchanged.

## Scenario 12 — Long Content

Long customer names, addresses, mould IDs, technical descriptions and terms must produce a readable PDF without clipping or markup failures.

## Scenario 13 — Offline

Disconnect the internet and verify the core workflow still works.

---

# 76. Definition of Ready

A feature/task is ready for implementation when:

- The requirement is documented.
- Its behavior is unambiguous.
- Required dependencies are known.
- Acceptance criteria exist.
- Test strategy is understood.
- No unresolved blocking decision exists.

---

# 77. Definition of Done

A requirement is complete when:

- The behavior is implemented.
- Automated tests cover relevant business rules.
- Acceptance criteria pass.
- No unrelated behavior was introduced.
- Documentation is updated when behavior changed.
- The implemented task is explicitly marked complete.

A checked task without evidence is not considered complete.

---

# 78. Priority

## P0 — Core Product

- Local/offline operation
- Company setup
- Customer setup
- Draft invoices
- Invoice finalization
- Invoice numbering
- Mould/job information
- Line items
- HSN/SAC
- Quantity/unit/rate
- GST calculation
- Tax summary
- Round-off
- Grand total
- Amount in words
- Invoice history
- PDF generation
- PDF export
- Printing
- Finalized invoice immutability
- Historical snapshots
- Basic backup/restore

## P1 — Important

- Due date
- Payment terms
- PO/challan/logistics
- Bill-To/Ship-To
- Bank details
- UPI/QR
- Payment status
- Cancellation reason
- Duplicate invoice
- Notes
- Terms & Conditions
- Declaration
- Logo
- Signature/stamp
- Search/filter
- Multi-page PDF handling
- Restore reconciliation

## P2 — Optional

- Service templates
- CSV import
- Excel export
- Multiple companies
- Multiple visual templates
- Multi-language UI
- Dark mode
- Full payment ledger
- Recurring invoices
- Email integration

---

# 79. Product Boundaries

Version 1 should remain focused on:

```text
Create
Calculate
Finalize
Store
Generate
Print
Search
Recover
```

It should not become:

```text
ERP
Accounting Suite
CRM
Manufacturing System
Inventory System
Cloud SaaS
```

---

# 80. Important Open Decisions

Before implementing the affected areas, explicitly decide:

1. Exact invoice-number allocation point.
2. Existing Tally sequence initialization procedure.
3. Financial-year and backdated invoice-number behavior.
4. Exact place-of-supply policy.
5. GST special-case scope.
6. Future-date invoice policy.
7. Payment-status workflow beyond simple status.
8. Historical PDF re-rendering policy.
9. Template version strategy.
10. Restore sequence-reconciliation workflow.
11. Cancellation behavior for invoices that may already have been externally reported.
12. Exact customer/company field requirements for finalization.

These decisions must be recorded rather than guessed by an AI coding agent.

---

# 81. Final Product Definition

The application is successful when a business operator can:

```text
Open the application
        ↓
Select a customer
        ↓
Enter mould / machining work
        ↓
Enter quantity and rate
        ↓
See correct GST and total
        ↓
Finalize the invoice
        ↓
Get a professional A4 PDF
        ↓
Print or save it
        ↓
Find the invoice later
        ↓
Keep the invoice safe through backup
```

The defining product quality is not the number of screens or features.

It is:

> **A simple local billing tool that produces correct, professional, reproducible mould/machining invoices and protects the business's invoice history.**
