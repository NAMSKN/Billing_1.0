# Requirements: Vendor & Customer Management

## Introduction

This specification defines testable requirements for unified **Vendor & Customer Management** (`vendor-customer`) within the desktop billing application.

The feature enables the operator to maintain external trading entities (customers, suppliers, subcontractors, and dual-role partners), validate their statutory details (GSTIN, PAN), manage multiple delivery addresses, and link them to invoices and procurement vouchers.

Canonical business rules are defined in [`docs/feature/vendor-customer/VENDOR_CUSTOMER_RULES.md`](../../../docs/feature/vendor-customer/VENDOR_CUSTOMER_RULES.md).
UI presentation layout is defined in [`docs/feature/vendor-customer/UI_LAYOUT.md`](../../../docs/feature/vendor-customer/UI_LAYOUT.md).

---

## Requirements

### Requirement 1: Entity Roles & Categorization
- The system shall support three entity roles: `CUSTOMER`, `VENDOR`, and `BOTH`.
- Dual-role entities shall be manageable as a single profile while discoverable in both customer and vendor contexts.

### Requirement 2: Statutory Tax Validation
- The system shall validate 15-character Indian GSTINs using checksum validation.
- When a valid GSTIN is entered, the system shall automatically derive the State code and PAN.

### Requirement 3: Multi-Address Support
- Every party shall have a primary billing address.
- An optional distinct shipping/consignee address shall be supported.

### Requirement 4: Archival & Historical Immutability
- Entities referenced by past invoices or transactions shall not be hard-deleted.
- Deactivating an entity (`is_active = false`) shall remove it from new transaction selectors while preserving historical records intact.
