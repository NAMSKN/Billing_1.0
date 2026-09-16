import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type IpcResult } from '@shared/ipc';

/**
 * Preload script. Runs in an isolated context (contextIsolation: true) with no
 * Node integration. It exposes exactly ONE object, `window.api`, whose methods
 * are thin, allow-listed wrappers over ipcRenderer.invoke for known channels.
 *
 * The renderer can never reach ipcRenderer, require, or the filesystem
 * directly — only the named methods below. Channel names are validated against
 * the shared allow-list so a compromised renderer cannot invoke arbitrary IPC.
 */

const ALLOWED = new Set<string>(Object.values(IpcChannel));

function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  if (!ALLOWED.has(channel)) {
    return Promise.resolve({
      ok: false,
      error: { code: 'FORBIDDEN_CHANNEL', message: `channel not allowed: ${channel}` },
    });
  }
  return ipcRenderer.invoke(channel, payload);
}

const api = {
  ping: () => invoke<string>(IpcChannel.Ping),
  appInfo: () => invoke(IpcChannel.AppInfo),

  calcPreview: (payload: unknown) => invoke(IpcChannel.CalcPreview, payload),

  company: {
    get: () => invoke(IpcChannel.CompanyGet),
    save: (payload: unknown) => invoke(IpcChannel.CompanySave, payload),
  },
  settings: {
    get: () => invoke(IpcChannel.SettingsGet),
    save: (payload: unknown) => invoke(IpcChannel.SettingsSave, payload),
  },
  customers: {
    list: (payload?: unknown) => invoke(IpcChannel.CustomerList, payload),
    get: (id: string) => invoke(IpcChannel.CustomerGet, id),
    save: (payload: unknown) => invoke(IpcChannel.CustomerSave, payload),
    archive: (id: string) => invoke(IpcChannel.CustomerArchive, id),
  },
  invoices: {
    createDraft: (payload?: unknown) => invoke(IpcChannel.InvoiceCreateDraft, payload),
    saveDraft: (payload: unknown) => invoke(IpcChannel.InvoiceSaveDraft, payload),
    get: (id: string) => invoke(IpcChannel.InvoiceGet, id),
    listSummaries: (payload?: unknown) => invoke(IpcChannel.InvoiceListSummaries, payload),
    checkReadiness: (payload: unknown) => invoke(IpcChannel.InvoiceCheckReadiness, payload),
    finalize: (payload: unknown) => invoke(IpcChannel.InvoiceFinalize, payload),
    cancel: (payload: unknown) => invoke(IpcChannel.InvoiceCancel, payload),
    duplicate: (id: string) => invoke(IpcChannel.InvoiceDuplicate, id),
    setPaymentStatus: (payload: unknown) => invoke(IpcChannel.InvoiceSetPaymentStatus, payload),
    deleteDraft: (id: string) => invoke(IpcChannel.InvoiceDeleteDraft, id),
  },
  pdf: {
    preview: (id: string) => invoke(IpcChannel.PdfPreview, id),
    export: (payload: unknown) => invoke(IpcChannel.PdfExport, payload),
  },
  backup: {
    create: () => invoke(IpcChannel.BackupCreate),
    restore: (payload: unknown) => invoke(IpcChannel.BackupRestore, payload),
  },
  parties: {
    list: (payload: unknown) => invoke(IpcChannel.PartyList, payload),
    get: (id: string) => invoke(IpcChannel.PartyGet, id),
    save: (payload: unknown) => invoke(IpcChannel.PartySave, payload),
    archive: (id: string) => invoke(IpcChannel.PartyArchive, id),
    groupList: () => invoke(IpcChannel.PartyGroupList),
    groupCreate: (name: string) => invoke(IpcChannel.PartyGroupCreate, name),
    importPreview: (payload: unknown) => invoke(IpcChannel.PartyImportPreview, payload),
    importCommit: (token: string) => invoke(IpcChannel.PartyImportCommit, token),
    export: (payload: unknown) => invoke(IpcChannel.PartyExport, payload),
  },
  products: {
    list: (payload: unknown) => invoke(IpcChannel.ProductList, payload),
    get: (id: string) => invoke(IpcChannel.ProductGet, id),
    save: (payload: unknown) => invoke(IpcChannel.ProductSave, payload),
    archive: (id: string) => invoke(IpcChannel.ProductArchive, id),
    sellable: () => invoke(IpcChannel.ProductSellable),
    groupList: () => invoke(IpcChannel.ProductGroupList),
    groupCreate: (name: string) => invoke(IpcChannel.ProductGroupCreate, name),
    groupRename: (payload: unknown) => invoke(IpcChannel.ProductGroupRename, payload),
    groupArchive: (id: string) => invoke(IpcChannel.ProductGroupArchive, id),
    importPreview: (payload: unknown) => invoke(IpcChannel.ProductImportPreview, payload),
    importCommit: (token: string) => invoke(IpcChannel.ProductImportCommit, token),
    export: (payload: unknown) => invoke(IpcChannel.ProductExport, payload),
  },
  dashboard: {
    report: () => invoke(IpcChannel.DashboardReport),
  },
  stock: {
    list: (payload?: unknown) => invoke(IpcChannel.StockList, payload),
    adjust: (payload: unknown) => invoke(IpcChannel.StockAdjust, payload),
    adjustMany: (payload: unknown) => invoke(IpcChannel.StockAdjustMany, payload),
    log: (payload: unknown) => invoke(IpcChannel.StockLog, payload),
    bulkExport: () => invoke(IpcChannel.StockBulkExport),
    bulkImportPreview: () => invoke(IpcChannel.StockBulkImportPreview),
    bulkImportCommit: (token: string) => invoke(IpcChannel.StockBulkImportCommit, token),
    logExport: (payload: unknown) => invoke(IpcChannel.StockLogExport, payload),
  },
  inventory: {
    get: () => invoke(IpcChannel.InventoryGet),
    set: (enabled: boolean) => invoke(IpcChannel.InventorySet, enabled),
  },
};

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
