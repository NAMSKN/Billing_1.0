/**
 * IPC channel contract shared between the main process and the renderer.
 *
 * Security model: the renderer has NO direct access to Node, the filesystem,
 * SQLite, or PDF generation. Every capability is a named, typed channel routed
 * through the contextBridge preload (see src/preload/index.ts) and handled in
 * the main process. Keeping the contract in one shared module lets both sides
 * stay type-safe without leaking implementation.
 *
 * All monetary values that cross the boundary are serialized as decimal
 * strings (e.g. "12280.00"), never JS floats, to preserve exactness. The main
 * process converts to/from Decimal and integer paise at its own boundary.
 */

/** Channels the renderer may invoke (request/response via ipcRenderer.invoke). */
export const IpcChannel = {
  Ping: 'app:ping',
  AppInfo: 'app:info',

  // Calculation preview (pure, no persistence) — used for live UI totals.
  CalcPreview: 'calc:preview',

  // Company / settings
  CompanyGet: 'company:get',
  CompanySave: 'company:save',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',

  // Customers
  CustomerList: 'customer:list',
  CustomerGet: 'customer:get',
  CustomerSave: 'customer:save',
  CustomerArchive: 'customer:archive',

  // Invoices
  InvoiceCreateDraft: 'invoice:createDraft',
  InvoiceSaveDraft: 'invoice:saveDraft',
  InvoiceGet: 'invoice:get',
  InvoiceListSummaries: 'invoice:listSummaries',
  InvoiceCheckReadiness: 'invoice:checkReadiness',
  InvoiceFinalize: 'invoice:finalize',
  InvoiceCancel: 'invoice:cancel',
  InvoiceDuplicate: 'invoice:duplicate',
  InvoiceSetPaymentStatus: 'invoice:setPaymentStatus',
  InvoiceDeleteDraft: 'invoice:deleteDraft',

  // PDF
  PdfPreview: 'pdf:preview',
  PdfExport: 'pdf:export',

  // Backup / restore
  BackupCreate: 'backup:create',
  BackupRestore: 'backup:restore',
  RevealPath: 'shell:revealPath',

  // Parties (unified customer/vendor master)
  PartyList: 'party:list',
  PartyGet: 'party:get',
  PartySave: 'party:save',
  PartyArchive: 'party:archive',
  PartyGroupList: 'party:groupList',
  PartyGroupCreate: 'party:groupCreate',
  PartyImportPreview: 'party:importPreview',
  PartyImportCommit: 'party:importCommit',
  PartyExport: 'party:export',

  // Products / services
  ProductList: 'product:list',
  ProductGet: 'product:get',
  ProductSave: 'product:save',
  ProductArchive: 'product:archive',
  ProductSellable: 'product:sellable',
  ProductGroupList: 'product:groupList',
  ProductGroupCreate: 'product:groupCreate',
  ProductGroupRename: 'product:groupRename',
  ProductGroupArchive: 'product:groupArchive',
  ProductImportPreview: 'product:importPreview',
  ProductImportCommit: 'product:importCommit',
  ProductExport: 'product:export',

  // Dashboard / reporting
  DashboardReport: 'dashboard:report',

  // Stock ledger
  StockList: 'stock:list',
  StockAdjust: 'stock:adjust',
  StockAdjustMany: 'stock:adjustMany',
  StockLog: 'stock:log',
  StockBulkExport: 'stock:bulkExport',
  StockBulkImportPreview: 'stock:bulkImportPreview',
  StockBulkImportCommit: 'stock:bulkImportCommit',
  StockLogExport: 'stock:logExport',
  InventoryGet: 'inventory:get',
  InventorySet: 'inventory:set',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

/** A uniform envelope so the renderer can distinguish success from typed errors. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

export interface IpcError {
  code: string;
  message: string;
  /** Optional field-level validation issues for form surfaces. */
  issues?: ValidationIssue[];
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'blocking' | 'warning';
}

export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  platform: string;
}
