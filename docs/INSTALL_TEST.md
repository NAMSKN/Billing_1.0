# Installation Test (Task 61)

Verifies that the packaged application installs and runs on a clean Windows
environment, and that first run creates the per-user data directory outside the
install location (Req 27; DECISIONS D-013).

The distributable is the one-folder PyInstaller build from Task 60
(`dist/InvoiceGenerator/`); see `packaging/README.md` for how it is produced.

## Definition of Done

- [x] Data directory created on first run.
- [x] Application opens (window launches, no crash).

## Clean-environment test procedure

A "clean environment" means: the app copied to an install location it has never
run from, and **no** existing `%LOCALAPPDATA%\InvoiceGenerator` user-data
directory.

1. Ensure no `InvoiceGenerator` process is running.
2. Move any existing `%LOCALAPPDATA%\InvoiceGenerator` aside (so first run is
   genuinely first run).
3. Copy `dist/InvoiceGenerator/` to a fresh install location, e.g.
   `%LOCALAPPDATA%\Programs\InvoiceGenerator-installtest\`.
4. Launch `InvoiceGenerator.exe` from the install location.
5. Confirm the user-data directory and its subfolders are created.
6. Confirm the database file is created (migrations applied on first run).
7. Confirm the app window opens and the process stays alive.
8. Restore the original user-data directory; remove the temp install.

### PowerShell used for the verification run

```powershell
# 2. Move existing data aside
$root = Join-Path $env:LOCALAPPDATA "InvoiceGenerator"
Rename-Item $root "$root.installtest-bak"

# 3. Install into a fresh location
$install = Join-Path $env:LOCALAPPDATA "Programs\InvoiceGenerator-installtest"
New-Item -ItemType Directory -Path $install -Force | Out-Null
Copy-Item -Recurse -Force "dist/InvoiceGenerator/*" $install

# 4. Launch
& (Join-Path $install "InvoiceGenerator.exe")

# 5-7. Verify data dir + db + process (after a few seconds)
Get-ChildItem $root | Select-Object Name
Test-Path (Join-Path $root "database\invoices.db")
Get-Process -Name InvoiceGenerator
```

## Verified results (Windows, win32)

Install location: `%LOCALAPPDATA%\Programs\InvoiceGenerator-installtest\`
(separate from the build tree and from the user-data directory).

- Application launched from the installed `InvoiceGenerator.exe`; the process
  started and remained running (window opened, no crash).
- First run created the user-data directory
  `%LOCALAPPDATA%\InvoiceGenerator\` — **outside** the install directory — with
  all expected subfolders: `assets`, `backups`, `database`, `exports`, `logs`.
- Migrations ran on first launch: `database\invoices.db` was created
  (~100 KB, schema present).
- `logs\app.log` recorded the startup line:
  `INFO invoice_generator: Invoice Generator starting; data directory
  C:\Users\<user>\AppData\Local\InvoiceGenerator`.

Both Definition-of-Done criteria are met: the data directory is created and the
application opens. Because user data lives outside the install folder, replacing
or removing the install directory does not affect existing invoices or backups
(DECISIONS D-013).

## Notes / limitations

- This run installed to a per-user location and did not exercise a system-wide
  installer (MSI/NSIS); packaging an installer is not in the current task scope.
- The app requires the whole `dist/InvoiceGenerator/` folder, not just the
  `.exe`; distribute the folder (or wrap it in an installer) accordingly.
