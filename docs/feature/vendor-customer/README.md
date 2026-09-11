# 👥 Feature: Vendor & Customer Management (`vendor-customer`)

> **Domain:** Master Data Management (Parties / Entities)  
> **Status:** Draft / Proposed Feature Baseline  
> **Parent System:** [Billing System Documentation](../../README.md)

---

## 📌 Overview

The **Vendor & Customer Management** (`vendor-customer`) feature provides centralized master data management for all external trading entities interacting with the mould/machining business:

- **Customers (Buyers / Clients):** Entities to whom invoices, delivery challans, and quotations are issued.
- **Vendors (Suppliers / Subcontractors):** Suppliers providing raw materials (steel blocks, standard mould bases, ejector pins) or outsourced machining processes (heat treatment, EDM wire-cut, surface coating).
- **Dual-Role Entities:** Business partners who act as both customer and vendor.

---

## 📚 Feature Documentation

Following our documentation architecture standards, all specifications for this feature are organized below:

| Document | Description | Key Focus Areas |
|---|---|---|
| [**`VENDOR_CUSTOMER_RULES.md`**](./VENDOR_CUSTOMER_RULES.md) | Business Rules Baseline | Entity types, GSTIN/PAN parsing & validation, multiple delivery addresses, credit terms, and soft-delete/archival policies. |
| [**`UI_LAYOUT.md`**](./UI_LAYOUT.md) | UI Layout & Interaction Spec | Master list screens, role filtering (`Customer` / `Vendor`), entity editor forms, address cards, and keyboard navigation. |
| [**`ACCEPTANCE.md`**](./ACCEPTANCE.md) | Feature Acceptance Criteria | Functional acceptance criteria, data integrity checks, duplicate prevention, and invoice linking validation. |

---

## 🔄 Entity Lifecycle & Relationships

```text
               ┌───────────────────────┐
               │ Create Trading Entity │
               └──────────┬────────────┘
                          │
                          ▼
               ┌───────────────────────┐
               │ Assign Party Role(s)  │
               │ - Customer (Buyer)    │
               │ - Vendor (Supplier)   │
               │ - Both                │
               └──────────┬────────────┘
                          │
                          ▼
               ┌───────────────────────┐
               │ Statutory & Address   │
               │ - 15-char GSTIN / PAN │
               │ - Billing Address     │
               │ - Shipping / Godown   │
               └──────────┬────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
 ┌──────────────────────┐   ┌──────────────────────┐
 │  Customer Workflows  │   │   Vendor Workflows   │
 │ - Invoice Generation │   │ - Purchase Vouchers  │
 │ - Delivery Challans  │   │ - Job Work Tracking  │
 │ - Quotations         │   │ - Outward Machining  │
 └──────────────────────┘   └──────────────────────┘
```

---

## 🔗 Related Documentation

- [**System Architecture**](../../ARCHITECTURE.md) – Clean Architecture layers, SQLite repository boundaries, and database migrations.
- [**Invoice Generator**](../invoice-generator/README.md) – Customer party consumption during invoice creation and snapshotting.
- [**Architecture Decisions**](../../DECISIONS.md) – Canonical decisions regarding SQLite storage, typing, and platform portability.
