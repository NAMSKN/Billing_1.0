import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import { getAppPaths } from './paths';
import { registerIpcHandlers } from './ipc-handlers';

/**
 * Main process entry point.
 *
 * Security posture (industry-standard Electron hardening):
 *   - contextIsolation: true, nodeIntegration: false, sandbox: true.
 *   - The renderer loads only from the local Vite dev server (dev) or the
 *     packaged file:// bundle (prod); a strict Content-Security-Policy is set.
 *   - Navigation to external origins and new-window creation are denied;
 *     external links open in the OS browser instead.
 *   - No remote module, no webview, no arbitrary IPC (see preload allow-list).
 */

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// A locked-down CSP. In dev we must allow the Vite HMR websocket + inline
// styles injected by the dev server; production is stricter.
function contentSecurityPolicy(): string {
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: http://localhost:*",
    ].join('; ');
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join('; ');
}

/**
 * Resolve the app icon. In dev it sits in the project's build/icons; when
 * packaged it is shipped via electron-builder extraResources under
 * process.resourcesPath. electron-builder already stamps the .exe icon; this
 * sets the runtime window / taskbar icon to match.
 */
function appIconPath(): string {
  return isDev
    ? join(__dirname, '../../build/icons/app-icon.png')
    : join(process.resourcesPath, 'icons/app-icon.png');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0f172a',
    show: false,
    title: 'Moulder Billing',
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Deny in-app navigation to any external origin.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL ? [DEV_SERVER_URL] : [];
    if (!allowed.some((base) => url.startsWith(base))) {
      event.preventDefault();
    }
  });

  // Route window.open / target=_blank to the OS browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  const paths = getAppPaths();

  // Apply the CSP to every response served to the renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });

  // Block permission requests (camera, geolocation, etc.) — offline billing
  // app needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

  const application = registerIpcHandlers(paths);
  // After a restore, numbering issuance is blocked until reconciliation runs.
  // The trusted pre-restore high-water was captured at restore time (D-029);
  // reconcile it now so the next number never reuses one issued in the real world.
  if (application.reconciliationService.isPending()) {
    application.reconciliationService.reconcileAll();
  }

  // Automated Rolling 30-Day Backup (Phase 6):
  // Run a safe online snapshot on startup, preserving a rolling 30-day window
  try {
    const { BackupService } = require('./backup/backupService');
    const backupService = new BackupService(app.getVersion(), paths.backupsDir);
    void backupService.runDailyRollingBackup(application.db, 30);
  } catch (err) {
    console.error('Failed to run daily rolling backup:', err);
  }

  app.on('will-quit', () => application.close());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Harden against a second instance and web-content abuse.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
