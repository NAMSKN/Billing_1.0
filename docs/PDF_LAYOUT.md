# PDF_LAYOUT
## Professional Invoice PDF Layout for Mould / Mould-Machining Business

**Document Version:** 1.0  
**Status:** PDF Layout Baseline  
**Related Documents:** `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `INVOICE_RULES.md`

---

# 1. Purpose

This document defines the visual and structural requirements for the generated invoice PDF.

The design is based on:

- The two actual Tally invoices used for mould/machining work.
- The Tata Motors sample invoice used as a visual reference.

The goal is not to copy either document exactly.

The goal is to preserve the useful billing/accounting information of the Tally invoices while adopting the cleaner visual hierarchy of the reference design.

---

# 2. Design Principles

The final invoice must be:

- Professional
- Clean
- Easy to scan
- Printer-friendly
- Suitable for black-and-white printing
- Suitable for digital PDF sharing
- Technically readable
- Tax-information friendly
- Suitable for mould/machining businesses

Do not make the document overly decorative.

The invoice should look like a serious business document.

---

# 3. Page Format

Default:

```text
Paper: A4
Orientation: Portrait
```

The layout should normally fit on one page for ordinary invoices.

For invoices containing many line items:

- Continue naturally onto additional pages.
- Repeat the line-item header on subsequent pages.
- Keep totals and signature sections together where possible.
- Never compress text to an unreadable size merely to force one page.

---

# 4. Margin Guidelines

Recommended starting point:

```text
Top:    ~12–15 mm
Bottom: ~12–15 mm
Left:   ~12–15 mm
Right:  ~12–15 mm
```

Exact values may be adjusted during visual refinement.

Maintain a safe printable area.

---

# 5. Overall Page Structure

Recommended vertical order:

```text
┌────────────────────────────────────────────────────┐
│ HEADER / BRANDING                                  │
├────────────────────────────────────────────────────┤
│ INVOICE METADATA                                   │
├──────────────────────┬─────────────────────────────┤
│ BILL TO              │ SHIP TO / CONSIGNEE         │
├──────────────────────┴─────────────────────────────┤
│ REFERENCES / LOGISTICS                              │
├────────────────────────────────────────────────────┤
│ MOULD / MACHINING LINE ITEMS                       │
├────────────────────────────────────────────────────┤
│ TAX SUMMARY                                         │
├────────────────────────────────────────────────────┤
│ TOTALS / AMOUNT IN WORDS                           │
├──────────────────────────┬─────────────────────────┤
│ PAYMENT / BANK DETAILS   │ QR / PAYMENT           │
├──────────────────────────┴─────────────────────────┤
│ NOTES / TERMS                                      │
├────────────────────────────────────────────────────┤
│ DECLARATION / SIGNATURE                            │
├────────────────────────────────────────────────────┤
│ FOOTER / PAGE NUMBER                               │
└────────────────────────────────────────────────────┘
```

---

# 6. Header

The header should be the strongest branding area.

Recommended arrangement:

```text
LEFT
Company Logo
Company Name
Address
GSTIN
Phone / Email

RIGHT
TAX INVOICE
ORIGINAL FOR RECIPIENT
Invoice Number
Invoice Date
Due Date
Place of Supply
```

The company name should be visually prominent.

The invoice title should be immediately recognizable.

---

# 7. Company Branding

Support:

- Logo
- Company name
- Address
- GSTIN
- State
- Email
- Phone

Logo:

- Should maintain aspect ratio.
- Should not dominate the page.
- Should not interfere with invoice information.

A monochrome-friendly version may be used where needed.

---

# 8. Invoice Metadata Box

A compact box should show:

```text
Invoice No.
Invoice Date
Due Date
Place of Supply
Payment Terms
```

Optional fields should only appear when values are available.

Do not render empty placeholders such as:

```text
Due Date:
Place of Supply:
```

when the information is not provided, unless the design explicitly requires fixed alignment.

---

# 9. Bill To / Ship To

Use two visually distinct sections.

## Bill To

Show:

- Customer name
- Billing address
- GSTIN
- State
- State code
- Phone/email when useful

## Ship To / Consignee

Show:

- Consignee/customer name
- Shipping address
- GSTIN where relevant
- State
- Godown address when applicable

When Bill To and Ship To are identical, the UI may still show both sections because the Tally source structure explicitly distinguishes them.

---

# 10. Reference / Logistics Section

Use a compact grid.

Possible fields:

```text
PO No.
PO Date
Challan No.
Challan Date
Delivery Note
Delivery Note Date
Dispatch Document No.
Vehicle No.
Dispatched Through
Destination
Terms of Delivery
Other References
```

Do not give this area more visual weight than the customer and invoice sections.

Only render populated values.

---

# 11. Mould / Machining Line-Item Section

This is the most important design area for this business.

The table should prioritize technical/job information.

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

Depending on available horizontal space, `JOB / MOULD` and `OPERATION` may be combined, but technical readability must remain.

---

# 12. Example Line Item

A line should be visually capable of representing:

```text
Job/Mould: DT-663
Operation: PUNCH GUN DRILLING
Specification: DRILL DIA 9X307MM DEEP
Qty: 16
Unit: NOS
HSN/SAC: 998898
```

Avoid rendering this as one cramped sentence when structured data is available.

---

# 13. Technical Description Rules

The PDF must preserve:

- Mould/job reference
- Operation
- Technical specification
- Dimensions
- Quantity
- Unit

Long descriptions should wrap naturally.

Do not clip technical text.

Example:

```text
6 SIDE MACHINING
510 × 430 × 130
```

should remain clearly legible.

---

# 14. Table Typography

The line-item header should:

- Be bold
- Have strong separation from body rows
- Remain readable in grayscale

Body text should be compact but not tiny.

Recommended starting range:

```text
Body: 8–9 pt
Header: 8–9 pt bold
```

Final sizes should be validated on a real A4 print.

---

# 15. Column Alignment

Use:

```text
Text:
left aligned

Quantity:
right aligned

Rate:
right aligned

Discount:
right aligned

Amounts:
right aligned

HSN/SAC:
center or left aligned

Unit:
center aligned
```

Currency values should align by decimal place as much as practical.

---

# 16. Line Item Amount

The final amount column should be visually clear.

The user should be able to identify the amount for each service without scanning the entire row.

Avoid excessive currency symbols in every cell if they make the table noisy; use a clear INR convention in the table/header and totals.

---

# 17. Tax Summary

After the main line-item table, provide a compact tax summary.

Recommended structure:

```text
HSN/SAC | Taxable Value | CGST | SGST | IGST | Total Tax
```

Or, where space permits:

```text
HSN/SAC
Taxable Value
CGST Rate
CGST Amount
SGST Rate
SGST Amount
IGST Rate
IGST Amount
Total Tax
```

The final implementation should adapt column count according to the applicable tax mode.

Do not show irrelevant zero-value tax columns if doing so would unnecessarily clutter the invoice.

---

# 18. Totals Block

The totals should be visually prominent.

Recommended alignment:

```text
                       Taxable Amount   ₹xx,xxx.xx
                       CGST             ₹x,xxx.xx
                       SGST             ₹x,xxx.xx
                       IGST             ₹x,xxx.xx
                       Round Off          ₹xx.xx
                       -------------------------
                       GRAND TOTAL      ₹xx,xxx.xx
```

Grand Total:

- Largest monetary value on the page
- Bold
- Strong border or background distinction
- Easy to locate immediately

---

# 19. Amount in Words

Place amount in words below or beside the total block.

Example:

```text
Amount in Words:
INR Fourteen Thousand Four Hundred Ninety Only
```

And:

```text
Tax Amount in Words:
INR Two Thousand Two Hundred Ten and Forty Paise Only
```

The text should wrap without affecting the alignment of the grand total.

---

# 20. Payment Section

The payment area may contain:

### Bank Details

```text
Bank Name
Account Number
Branch
IFSC
```

### UPI

```text
UPI ID
UPI QR Code
```

QR should only appear when configured.

Do not show a blank QR placeholder.

---

# 21. Payment Status

Payment status may be shown as a small visual indicator:

```text
UNPAID
PARTIALLY PAID
PAID
```

The status must be visually secondary to the invoice total.

Do not make an "Amount Paid" badge look like the grand total.

---

# 22. Notes

Notes may contain:

- Job notes
- Delivery notes
- Special instructions
- Inspection information

Use a compact block.

Heading:

```text
Notes
```

Do not give notes excessive space unless content requires it.

---

# 23. Terms & Conditions

Terms should be placed toward the bottom.

Use a smaller but readable font.

Example structure:

```text
Terms & Conditions
1. ...
2. ...
3. ...
```

Do not let legal text overpower the invoice totals.

---

# 24. Declaration

Provide a compact declaration block.

Example concept:

```text
Declaration:
We declare that this invoice shows the actual price of the
goods/services described and that all particulars are true
and correct.
```

Exact wording should come from configured business settings.

---

# 25. Signature Area

Recommended right-aligned structure:

```text
For SUNTECH ENTERPRISES

[Signature / Stamp]

Authorized Signatory
```

If a signature/stamp image is configured:

- Preserve aspect ratio.
- Do not upscale excessively.
- Keep it clearly separated from other footer text.

---

# 26. Footer

Footer may contain:

```text
This is a Computer Generated Invoice
Page 1 of 1
```

The page number should update automatically for multi-page invoices.

---

# 27. Borders and Separators

Use borders selectively.

Recommended:

- Strong outer document structure
- Clear section separators
- Table borders where useful
- Light internal lines
- Stronger line around Grand Total

Avoid making every small element look like a boxed form.

The Tally invoices use dense grid lines; the improved version should reduce unnecessary visual noise while preserving structure.

---

# 28. Color

The invoice must remain understandable when printed in grayscale.

Use color only for subtle hierarchy, such as:

- Header accent
- Section heading
- Grand total highlight
- Payment status

Do not rely on color alone to communicate required information.

A pure black-and-white print should remain fully understandable.

---

# 29. Typography

Use a professional sans-serif font for most content.

Recommended hierarchy:

```text
Company Name      — largest
TAX INVOICE       — very prominent
Section headings  — bold
Table headings    — bold
Body              — regular
Legal text        — smaller
Footer            — smallest
```

Avoid too many font families.

Use consistent capitalization.

---

# 30. Whitespace

Whitespace should separate logical sections.

The design should not:

- cram every field together
- fill every blank area
- push the totals to an awkward location

At the same time, excessive whitespace should not push important information unnecessarily onto a second page.

---

# 31. Page Break Rules

When an invoice exceeds one page:

1. Repeat the line-item table header.
2. Continue line items naturally.
3. Do not split a row across pages when avoidable.
4. Keep tax summary together where possible.
5. Keep grand total visible and intact.
6. Put signature/declaration on the final page.
7. Show page number on every page.

---

# 32. Long Technical Descriptions

For long mould specifications:

- Wrap text.
- Increase row height automatically.
- Preserve all content.
- Do not reduce font size below the minimum readable threshold merely to fit.

If necessary, split:

```text
Operation
Specification
Additional Description
```

into stacked content inside the same table cell.

---

# 33. Empty Fields

Do not print empty labels unless the design specifically requires them for alignment.

Bad:

```text
PO No.:
PO Date:
Vehicle No.:
```

when all are empty.

Prefer:

```text
PO No.  BMSS/L/070/26-27
Vehicle MH48CQ5748
```

only when populated.

---

# 34. Invoice 043 Visual Test

The PDF layout must cleanly represent the source information:

```text
Customer:
DI-TECH MOULDS

Service:
Service Charges @18% (Gundrilling)

Job:
DT-663

Operation:
PUNCH GUN DRILLING

Specification:
DRILL DIA 9X307MM DEEP

Quantity:
16 NOS.

HSN/SAC:
998898

Taxable:
₹12,280.00

CGST:
₹1,105.20

SGST:
₹1,105.20

Round Off:
-₹0.40

Grand Total:
₹14,490.00
```

The technical information must be immediately understandable.

---

# 35. Invoice 089 Visual Test

The PDF layout must cleanly represent:

```text
Customer:
BMSS STEEL INDUSTRIES PRIVATE LIMITED

PO:
BMSS/L/070/26-27

Challan:
CHALLAN NO. 353

Vehicle:
MH48CQ5748

Payment Terms:
30 Days

Line 1:
6 SIDE MACHINING 510X430X130

Line 2:
6 SIDE MACHINING 510X430X150

HSN/SAC:
998898

Taxable:
₹8,332.00

CGST:
₹749.88

SGST:
₹749.88

Round Off:
₹0.24

Grand Total:
₹9,832.00
```

---

# 36. Reference Image Design Influence

The Tata reference image should influence:

- Stronger hierarchy
- Cleaner metadata block
- More prominent total
- Clear customer section
- Clear payment section
- QR placement
- Notes
- Terms
- Signature treatment

It must NOT introduce unrelated Tata branding or automotive-specific content.

---

# 37. Tally Design Influence

The Tally invoices should influence:

- GST information
- HSN/SAC presentation
- Tax summary
- Declaration
- Bank details
- Invoice references
- Consignee/buyer distinction
- Mould/machining technical information
- Amount in words
- Computer-generated invoice footer

---

# 38. PDF Data Source

The PDF renderer must receive an already finalized/calculated invoice representation.

Conceptually:

```text
Stored Invoice
     ↓
Invoice DTO / View Model
     ↓
PDF Renderer
     ↓
A4 PDF
```

The renderer must not query the database directly for random fields.

The application layer should prepare the document data.

---

# 39. Visual Component Structure

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

Each component should have a focused responsibility.

---

# 40. PDF Quality Rules

Every generated PDF must be checked for:

- No clipped text
- No overlapping sections
- No broken table borders
- Correct page count
- Correct invoice number
- Correct customer
- Correct line-item values
- Correct tax
- Correct round-off
- Correct grand total
- Correct amount in words
- Correct logo rendering
- Correct QR rendering when enabled
- Correct signature rendering when enabled

---

# 41. Print Quality

The PDF must remain readable when:

- Printed in color
- Printed in black and white
- Printed at normal A4 scale

Do not rely on edge-to-edge printing.

Keep content inside safe margins.

---

# 42. Accessibility / Readability

Use:

- Adequate contrast
- Clear hierarchy
- Consistent alignment
- Readable font sizes
- Logical reading order

Important values such as:

```text
Invoice Number
Invoice Date
Customer
Grand Total
```

must be quickly discoverable.

---

# 43. PDF Acceptance Criteria

The final PDF is accepted when:

1. It resembles a professional business invoice.
2. It retains all required Tally-derived billing information.
3. Mould/job technical data is clearly presented.
4. GST information is clear.
5. Grand total is highly visible.
6. Amount in words is readable.
7. Bank/payment information is clearly separated.
8. Signature/declaration is clear.
9. Optional fields do not produce awkward empty blocks.
10. Multi-page invoices remain readable.
11. Black-and-white printing remains usable.
12. The source invoice calculation values can be reproduced exactly.

---

# 44. Recommended Visual Priority

Use this hierarchy:

```text
1. Company + TAX INVOICE
2. Invoice Number / Date
3. Customer
4. Mould / Job / Operation
5. Line-item Amounts
6. GRAND TOTAL
7. GST Summary
8. Payment Details
9. Notes / Terms
10. Legal / Footer
```

The invoice should communicate "what was billed and how much" before secondary information.

---

# 45. Final Layout Principle

The finished PDF should feel like:

```text
Tally's accounting accuracy
+
Modern business invoice clarity
+
Mould/machining technical readability
```

not:

```text
Tally copy
or
generic retail invoice
or
over-designed marketing document
```
