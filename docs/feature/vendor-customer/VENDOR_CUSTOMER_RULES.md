# VENDOR_CUSTOMER_RULES

## Business Rules for Vendor & Customer Master Data Management

**Document Version:** 1.0  
**Status:** Feature Specification Baseline  
**Related Documents:** `README.md`, `UI_LAYOUT.md`, `ACCEPTANCE.md`, `../../ARCHITECTURE.md`, `../invoice-generator/INVOICE_RULES.md`

---

# 1. Purpose

This document defines the canonical business rules governing the creation, validation, categorization, maintenance, archival, and data consumption of **Customers** (buyers) and **Vendors** (suppliers/subcontractors).

---

# 2. Entity Taxonomy & Roles

Every trading partner is registered as a **Party** with one or more operational roles:

1. **`CUSTOMER` (Buyer):**
   - Receives tax invoices, delivery challans, and quotations.
   - Requires billing address and optional shipping/consignee addresses.
2. **`VENDOR` (Supplier / Subcontractor):**
   - Supplies raw materials (e.g. D2, P20 steel blocks, mould bases) or provides outsourced job-work services (e.g. vacuum hardening, gun-drilling, surface treatment).
   - Requires procurement details, default expense category, and bank account for disbursements.
3. **`BOTH` (Customer & Vendor):**
   - Entity conducts bidirectional trade (e.g. customer supplies raw material for machining and receives finished mould components).
   - Maintains a single canonical party ID with unified profile.

---

# 3. Statutory & Tax Identification Rules

### 3.1 GSTIN (Goods and Services Tax Identification Number)
- Format: Exactly 15 alphanumeric characters matching regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`.
- **State Code:** Characters 1–2 represent the 2-digit Indian State/UT census code.
- **PAN Extraction:** Characters 3–12 represent the 10-character Permanent Account Number (PAN).
- **Checksum / Check-digit:** Validated according to the standard Indian GSTIN Luhn mod-36 algorithm.
- **Unregistered Entities:** Entities without GSTIN must be explicitly flagged as `UNREGISTERED` / `CONSUMER`. The State of supply must still be explicitly provided.

### 3.2 PAN (Permanent Account Number)
- Extracted automatically when GSTIN is provided.
- For unregistered vendors/customers, manual PAN entry is permitted with regex `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`.

---

# 4. Address Structure & Multi-Site Delivery

1. **Billing Address (Mandatory):**
   - Legal address appearing on formal Tax Invoices.
   - Contains: Line 1, Line 2, City, District, State, Postal Code (PIN code: 6 digits).
2. **Shipping / Consignee Address (Optional):**
   - Delivery destination when distinct from billing address (e.g. factory floor, testing lab, third-party press shop).
   - If empty, defaults to the billing address.
3. **Godown / Plant Reference (Optional):**
   - Secondary warehouse or godown address frequently referenced in mould tooling logistics.

---

# 5. Financial & Credit Policies

1. **Payment Terms:**
   - Default payment duration in days (e.g. Immediate, 15 Days, 30 Days, 45 Days, 60 Days).
   - Configurable default payment method (NEFT/RTGS, UPI, Cheque).
2. **Vendor Bank Details:**
   - Account Holder Name, Bank Name, Account Number, IFSC Code, Branch.
   - IFSC must match `^[A-Z]{4}0[A-Z0-9]{6}$`.
3. **Currency & Precision:**
   - All credit limits or outstanding balances are stored losslessly in **integer paise** (DECISIONS D-004).

---

# 6. Historical Integrity & Archival (Soft Delete)

1. **No Hard Deletion of Referenced Parties:**
   - A party referenced in any historical invoice (draft, finalized, or cancelled) **MUST NEVER** be physically deleted from SQLite.
2. **Archival / Deactivation (`is_active` flag):**
   - Operators may mark an inactive party as archived (`is_active = FALSE`).
   - Archived parties do not appear in auto-complete dropdowns for new invoices or purchase vouchers.
   - Historical invoices referencing archived parties remain fully visible, auditable, and reproducible.
3. **Snapshot Independence (DECISIONS D-020):**
   - When an invoice is finalized, the party details (legal name, GSTIN, addresses) are copied into the invoice's immutable snapshot.
   - Subsequent edits to the master party profile **never alter** past finalized invoices.

---

# 7. Uniqueness & Deduplication

- **Unique Active GSTIN:** Two active entities cannot share the same 15-character GSTIN.
- **Name Collision Warning:** A non-blocking warning is displayed if an operator creates a party with a legal name matching an existing record (case-insensitive trimmed comparison).
