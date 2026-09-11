# Technical Design: Vendor & Customer Management

## Architectural Overview

This design aligns with the application Clean Architecture described in [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md).

### Layers
1. **Domain Layer:**
   - Model: `Party` entity with `id`, `name`, `legal_name`, `role` (`CUSTOMER` | `VENDOR` | `BOTH`), `gstin`, `pan`, `billing_address`, `shipping_address`, `bank_details`, `is_active`.
   - Value Objects: `GSTIN`, `PAN`, `Address`, `BankDetails`.
   - Rules: `party_rules.py` (validation, checksum, role transitions).
2. **Application Layer:**
   - Services: `PartyService` (`create_party`, `update_party`, `archive_party`, `list_parties`, `search_parties`).
   - DTOs: `CreatePartyCommand`, `UpdatePartyCommand`, `PartyDTO`.
3. **Infrastructure Layer:**
   - Repository: `SqlitePartyRepository` implementing `PartyRepository` interface.
   - Migration: Schema update adding or enhancing `parties` table with role indices.
4. **Presentation Layer (PySide6):**
   - Controllers: `PartyController`.
   - Views: `PartyListScreen`, `PartyEditorDialog`.
