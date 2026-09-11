# Tasks: Customer / Vendor (Party) Master — V2 Feature 1

Business-facing roles are `CUSTOMER`, `VENDOR`, `CUSTOMER_VENDOR` (the earlier
`BOTH` naming is superseded). GSTIN is entered manually with format-only
validation; there is no GSTIN auto-fill and no online lookup (DECISIONS D-032,
D-033).

## Phase 1: Domain & Validation
- [x] 1. `PartyType` / `RegistrationType` / `BalanceType` enums and `Party`,
      `PartyAddress`, `OpeningBalance`, `BankDetails`, `PartyGroup` models.
- [x] 2. Format-only GSTIN/PAN/IFSC/email validation; India requires state+city;
      optional fields accept blanks. No auto-derivation.
- [x] 3. India state / GST-code master (`common.domain.india_states`).
- [x] 4. Unit tests for domain + rules.

## Phase 2: Persistence & Migration
- [x] 5. Migration `0003_parties.sql`: `party_groups`, `parties`, and data
      migration of existing customers into parties (same UUID).
- [x] 6. `SqlitePartyRepository`, `SqlitePartyGroupRepository`, mappers
      (INTEGER paise money; canonical UUID at the boundary).
- [x] 7. Repository/migration integration tests.

## Phase 3: Application Services
- [x] 8. `PartyService` (create/update/archive/list/search/filter, duplicate
      detection), `PartyGroupService` (create/rename/safe-archive), DTOs, errors.
- [x] 9. `CustomerProjection` port + `InvoiceCustomerProjection` adapter to keep
      the invoice-facing `customers` table in sync (DECISIONS D-034).
- [x] 10. Excel export (scope dialog logic, CUSTOMER_VENDOR dedupe) and import
      (header/row validation, preview, duplicate detection, import-as).
- [x] 11. Service + Excel integration tests.

## Phase 4: UI & Integration
- [x] 12. `PartyListScreen` (tabs, search, archived filter, Open/Edit/Archive,
      Import/Export) and `PartyEditorDialog` (all sections; India state dropdown;
      country default India; document visibility; opening balances).
- [x] 13. Wire into `bootstrap` + `main_window` ("Customers / Vendors" screen);
      invoice selector shows only customer-capable parties.
- [x] 14. Offscreen UI tests.

## Phase 5: Quality gates
- [x] 15. `pytest`, `ruff`, `mypy --strict` all pass.
- [x] 16. PyInstaller build produced and launches.
- [ ] 17. Manual acceptance on Windows (GUI walkthrough, resolutions, printing) —
      to be performed by the operator; not verifiable in this environment.
