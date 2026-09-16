# Moulder Billing (Electron)

Offline, Windows-first GST tax-invoice desktop application for a mould /
mould-machining business in India. Rebuilt in Electron + React + TypeScript from
the original Python/PySide6 application, preserving every business rule and the
golden invoice regression values exactly.

## Architecture

Clean layered architecture with dependencies pointing inward:

```
Renderer (React UI)  ──IPC──▶  Main: application services ─▶ domain (pure calc/rules) ─▶ repository ports
                                                                                            ▲
                                          infrastructure (better-sqlite3, pdfkit, fs, printing)
```

- **`src/shared/domain/`** — pure, framework-free domain: the single calculation
  engine (money, tax, totals, round-off), amount-in-words, numbering, validation,
  models/enums. Fully unit-tested; the golden invoices (043, 089) are the
  regression gate.
- **`src/main/`** — the Node/Electron main process: SQLite persistence
  (`db/`), application services (`app/`), PDF generation (`pdf/`), backup/restore
  (`backup/`), and the secure IPC handlers.
- **`src/preload/`** — the contextBridge preload exposing a minimal, allow-listed
  `window.api`.
- **`src/renderer/`** — the React UI (screens, components, design system).

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Strict Content-Security-Policy; navigation and `window.open` to external
  origins denied; permission requests denied.
- The renderer has no direct access to Node, the filesystem, SQLite, or PDF
  generation — only named IPC channels validated against a shared allow-list.
- All monetary values cross IPC as decimal strings (never floats).
- No network calls anywhere (offline is a product invariant).

## Money & correctness

- `Decimal` (decimal.js, `ROUND_HALF_UP`) for all money; never floats.
- Stored as integer paise / millis / hundredths; conversion only at the
  repository boundary.
- One calculation engine; the UI and PDF never recalculate.
- Finalized invoices are immutable snapshots; invoice numbers come from a
  dedicated sequence (never `MAX()`) and are never reused.

## Development

```bash
npm install            # installs deps; postinstall matches native modules to Electron
npm run dev            # Vite dev server + Electron (hot reload)
npm test               # rebuilds better-sqlite3 for Node, then runs the vitest suite
npm run typecheck      # tsc for renderer + main
npm run lint           # eslint
```

### Native module note

`better-sqlite3` is a native module and its ABI differs between Node (used by
the vitest test runner) and Electron (used to run/package the app):

- `npm test` runs `rebuild:node` first, so tests always use the Node ABI.
- `npm run rebuild:electron` rebuilds for Electron so `npm start` / `npm run dev`
  can run the app.
- `npm run dist` rebuilds for Electron and packages, and electron-builder's
  `install-app-deps` also matches native deps to the bundled Electron.

## Packaging

```bash
npm run dist           # produces release/MoulderBilling-Setup-<version>.exe (NSIS)
```

## Backup & restore

Backups use SQLite's safe online backup plus an integrity manifest (SHA-256 +
schema/app version + numbering high-water). Restore validates the package,
captures the current database's trusted numbering high-water mark, takes a
safety backup, replaces the database, and blocks new invoice-number issuance
until reconciliation completes — so numbers issued after an older backup are
never reused.
