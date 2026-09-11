# Tasks: Vendor & Customer Management

## Phase 1: Domain & Validation Logic
- [ ] 1. Define `PartyRole` enum (`CUSTOMER`, `VENDOR`, `BOTH`) and `Party` domain entity.
- [ ] 2. Implement GSTIN mod-36 validation, state-code extraction, and PAN parsing.
- [ ] 3. Write unit tests for domain entities and validation rules.

## Phase 2: Persistence & Migrations
- [ ] 4. Create SQLite migration for unified `parties` schema (or extending customer repository).
- [ ] 5. Implement `PartyRepository` with role filtering and active/archived queries.
- [ ] 6. Write integration tests for repository CRUD and soft-deletion.

## Phase 3: Application Services
- [ ] 7. Implement `PartyService` with duplicate GSTIN detection and address handling.
- [ ] 8. Write unit tests for application service layer.

## Phase 4: UI & Workflows
- [ ] 9. Implement `PartyListScreen` with search, role tabs (`All`, `Customers`, `Vendors`), and status badges.
- [ ] 10. Implement `PartyEditorDialog` with statutory validation feedback and multi-address tabs.
- [ ] 11. Wire navigation sidebar and shortcuts (`Ctrl+N`).
- [ ] 12. Run acceptance suite ([`docs/feature/vendor-customer/ACCEPTANCE.md`](../../../docs/feature/vendor-customer/ACCEPTANCE.md)).
