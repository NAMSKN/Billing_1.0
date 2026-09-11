# UI_LAYOUT

## UI Layout & Interaction Specification: Vendor & Customer Management

**Document Version:** 1.0  
**Status:** Feature Specification Baseline  
**Related Documents:** `README.md`, `VENDOR_CUSTOMER_RULES.md`, `../../ARCHITECTURE.md`

---

# 1. Screen Architecture

The **Vendor & Customer Management** screen is accessible from the primary desktop navigation sidebar.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Navigation: Dashboard | Invoices | Customers & Vendors | Settings]         │
├─────────────────────────────────────────────────────────────────────────────┤
│  👥 Customers & Vendors                                 [+ New Party (Ctrl+N)]│
├─────────────────────────────────────────────────────────────────────────────┤
│  🔍 Search: [Search name, GSTIN, phone... ]  Role: [All | Customers | Vendors]│
├─────────────────────────────────────────────────────────────────────────────┤
│  Table / Master List                                                        │
│  ┌──────────────┬──────────┬──────────────┬──────────────┬────────┬────────┐│
│  │ Name         │ Role     │ GSTIN        │ City, State  │ Phone  │ Actions││
│  ├──────────────┼──────────┼──────────────┼──────────────┼────────┼────────┤│
│  │ DI-TECH      │ Customer │ 27AAB...1Z5  │ Pune, MH     │ 982... │ Edit   ││
│  │ BMSS STEEL   │ Vendor   │ 27AAC...2Z1  │ Mumbai, MH   │ 991... │ Edit   ││
│  │ PRECISION PK │ Both     │ 29AAD...3Z8  │ Bangalore, KA│ 944... │ Edit   ││
│  └──────────────┴──────────┴──────────────┴──────────────┴────────┴────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 2. Party Editor Form Layout

When clicking **+ New Party** or **Edit**, an editor dialog/sheet appears:

### Tab 1: General & Statutory
- **Entity Type / Role:** Radio / Pill selector (`Customer`, `Vendor`, `Customer & Vendor`).
- **Display Name:** Short business identifier (e.g. `DI-TECH MOULDS`).
- **Legal Entity Name:** Registered firm name (e.g. `DI-TECH MOULDS PRIVATE LIMITED`).
- **GSTIN:** 15-character formatted input with auto-validation indicator (Green check / Red alert).
- **State & Code:** Automatically derived from GSTIN first two digits, or dropdown selection if unregistered.
- **PAN:** Read-only auto-populated from GSTIN characters 3–12 (or editable for unregistered).

### Tab 2: Addresses
- **Billing Address:** Line 1, Line 2, City, State, PIN Code.
- **Same as Billing toggle:** Checkbox defaulting to true for Shipping Address.
- **Shipping Address (Consignee):** Exposed when checkbox unchecked.
- **Godown / Plant Notes:** Optional text area.

### Tab 3: Banking & Payment (Required for Vendors, Optional for Customers)
- **Bank Name:** Free text or standard bank list.
- **Account Number & Re-enter Account Number.**
- **IFSC Code:** Uppercase 11-character input with auto-capitalization.
- **Default Credit Terms:** Dropdown (`Immediate`, `15 Days`, `30 Days`, `45 Days`).

---

# 3. Fast Keyboard Navigation
- `Ctrl + N`: Open New Party dialog.
- `Ctrl + F`: Focus quick search box.
- `Enter`: Save and close (when inside modal).
- `Esc`: Close editor (with unsaved changes confirmation if dirty).
- `Tab`: Logical forward tab order through all input fields without skipping.
