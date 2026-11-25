import { useEffect, useState } from 'react';
import {
  Building2,
  Landmark,
  Percent,
  Hash,
  FileSignature,
  Save,
  DatabaseBackup,
  Download,
  Upload,
  Boxes,
  Copy,
  FolderOpen,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import type { CompanyDto, TaxRateConfigDto } from '@shared/dto';
import type { NumberingConfig } from '@shared/domain/numbering';
import type { SettingsDefaults } from '@shared/domain/repositories';
import { isValidGstin, isValidIfsc } from '@shared/domain/validation';
import { unwrap, ApiError } from '../lib/api';
import { Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Textarea } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { StateSelect } from '../components/StateSelect';
import { useToast } from '../components/Toast';

interface SettingsBundle {
  tax: TaxRateConfigDto;
  numbering: NumberingConfig;
  defaults: SettingsDefaults;
}

function emptyCompany(): CompanyDto {
  return {
    id: '',
    name: '',
    address: { line: '', state_name: '', state_code: '', godown: '' },
    gstin: '',
    email: '',
    phone: '',
    bank_name: '',
    account_number: '',
    branch: '',
    ifsc: '',
    upi_id: '',
    authorized_signatory: '',
    logo_asset_id: null,
    signature_asset_id: null,
    active: true,
  };
}

export function Settings() {
  const toast = useToast();
  const [company, setCompany] = useState<CompanyDto>(emptyCompany());
  const [settings, setSettings] = useState<SettingsBundle | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = await unwrap<CompanyDto | null>(window.api.company.get());
      if (c) setCompany(c);
      setSettings(await unwrap<SettingsBundle>(window.api.settings.get()));
    })();
  }, []);

  const setC = (patch: Partial<CompanyDto>) => setCompany((c) => ({ ...c, ...patch }));
  const setAddr = (patch: Partial<CompanyDto['address']>) =>
    setCompany((c) => ({ ...c, address: { ...c.address, ...patch } }));

  const gstinError = company.gstin && !isValidGstin(company.gstin) ? 'Invalid GSTIN format' : '';
  const ifscError = company.ifsc && !isValidIfsc(company.ifsc) ? 'Invalid IFSC format' : '';

  const saveAll = async () => {
    if (!company.name.trim()) {
      toast.error('Company name is required');
      return;
    }
    if (gstinError || ifscError) {
      toast.error('Fix the highlighted format errors');
      return;
    }
    setSaving(true);
    try {
      const saved = await unwrap<CompanyDto>(window.api.company.save(company));
      setCompany(saved);
      if (settings) await unwrap(window.api.settings.save(settings));
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Company profile, tax configuration, and document defaults."
        actions={
          <Button onClick={() => void saveAll()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-accent" /> Company Profile
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="Company name" className="col-span-2">
              <Input value={company.name} onChange={(e) => setC({ name: e.target.value })} />
            </Field>
            <Field label="GSTIN" error={gstinError}>
              <Input
                value={company.gstin}
                onChange={(e) => setC({ gstin: e.target.value.toUpperCase() })}
                placeholder="29ABCDE1234F1Z5"
              />
            </Field>
            <Field label="State">
              <StateSelect
                code={company.address.state_code}
                onChange={(state_code, state_name) => setAddr({ state_code, state_name })}
              />
            </Field>
            <Field label="Address" className="col-span-2">
              <Input value={company.address.line} onChange={(e) => setAddr({ line: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={company.phone} onChange={(e) => setC({ phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input value={company.email} onChange={(e) => setC({ email: e.target.value })} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-accent" /> Bank &amp; Payment
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="Bank name">
              <Input value={company.bank_name} onChange={(e) => setC({ bank_name: e.target.value })} />
            </Field>
            <Field label="Account number">
              <Input
                value={company.account_number}
                onChange={(e) => setC({ account_number: e.target.value })}
              />
            </Field>
            <Field label="Branch">
              <Input value={company.branch} onChange={(e) => setC({ branch: e.target.value })} />
            </Field>
            <Field label="IFSC" error={ifscError}>
              <Input
                value={company.ifsc}
                onChange={(e) => setC({ ifsc: e.target.value.toUpperCase() })}
                placeholder="HDFC0001234"
              />
            </Field>
            <Field label="UPI ID">
              <Input value={company.upi_id} onChange={(e) => setC({ upi_id: e.target.value })} />
            </Field>
            <Field label="Authorized signatory">
              <Input
                value={company.authorized_signatory}
                onChange={(e) => setC({ authorized_signatory: e.target.value })}
              />
            </Field>
          </CardBody>
        </Card>

        {settings && (
          <>
            <div className="grid grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <span className="flex items-center gap-2">
                      <Percent className="h-4 w-4 text-accent" /> Tax Rates
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardBody className="grid grid-cols-2 gap-4">
                  <Field label="Total rate %">
                    <Input
                      value={settings.tax.total_rate}
                      onChange={(e) =>
                        setSettings({ ...settings, tax: { ...settings.tax, total_rate: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="IGST %">
                    <Input
                      value={settings.tax.igst_rate}
                      onChange={(e) =>
                        setSettings({ ...settings, tax: { ...settings.tax, igst_rate: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="CGST %">
                    <Input
                      value={settings.tax.cgst_rate}
                      onChange={(e) =>
                        setSettings({ ...settings, tax: { ...settings.tax, cgst_rate: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="SGST %">
                    <Input
                      value={settings.tax.sgst_rate}
                      onChange={(e) =>
                        setSettings({ ...settings, tax: { ...settings.tax, sgst_rate: e.target.value } })
                      }
                    />
                  </Field>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <span className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-accent" /> Invoice Numbering
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardBody className="grid grid-cols-2 gap-4">
                  <Field label="Prefix">
                    <Input
                      value={settings.numbering.prefix}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          numbering: { ...settings.numbering, prefix: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="Pad width">
                    <Input
                      type="number"
                      value={settings.numbering.pad_width}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          numbering: { ...settings.numbering, pad_width: Number(e.target.value) },
                        })
                      }
                    />
                  </Field>
                  <Field label="Start value">
                    <Input
                      type="number"
                      value={settings.numbering.start_value}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          numbering: { ...settings.numbering, start_value: Number(e.target.value) },
                        })
                      }
                    />
                  </Field>
                  <div className="flex items-end pb-1 text-xs text-muted-foreground">
                    e.g. {settings.numbering.prefix}/26-27/
                    {String(settings.numbering.start_value).padStart(settings.numbering.pad_width, '0')}
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <FileSignature className="h-4 w-4 text-accent" /> Document Defaults
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Default payment terms">
                  <Input
                    value={settings.defaults.payment_terms}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaults: { ...settings.defaults, payment_terms: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Default terms & conditions">
                  <Textarea
                    value={settings.defaults.terms}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaults: { ...settings.defaults, terms: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Declaration">
                  <Textarea
                    value={settings.defaults.declaration}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaults: { ...settings.defaults, declaration: e.target.value },
                      })
                    }
                  />
                </Field>
              </CardBody>
            </Card>

            <InventoryCard />

            <BackupCard />

            <AppLockCard />
          </>
        )}
      </div>
    </div>
  );
}

function InventoryCard() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const on = await unwrap<boolean>(window.api.inventory.get());
        setEnabled(on);
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  const toggle = async () => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    try {
      await unwrap(window.api.inventory.set(next));
      setEnabled(next);
      toast.success(next ? 'Inventory tracking enabled' : 'Inventory tracking disabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-accent" /> Inventory
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Turn on inventory tracking to show the Manage Stock screen, per-product stock levels, and
          low-stock alerts. Stock is adjusted manually; finalizing invoices does not change stock.
        </p>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="text-sm font-medium">
            {enabled === null ? 'Loading…' : enabled ? 'Enabled' : 'Disabled'}
          </span>
          <Button variant="outline" onClick={() => void toggle()} disabled={enabled === null || busy}>
            {enabled ? 'Turn Off' : 'Turn On'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function BackupCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const backup = async () => {
    setBusy('backup');
    try {
      const res = await unwrap<{ backupDir: string }>(window.api.backup.create());
      setLastBackup(res.backupDir);
      toast.success('Backup created');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Backup failed');
    } finally {
      setBusy(null);
    }
  };

  const copyPath = async () => {
    if (!lastBackup) return;
    try {
      await navigator.clipboard.writeText(lastBackup);
      toast.success('Path copied to clipboard');
    } catch {
      toast.error('Could not copy path');
    }
  };

  const openFolder = async () => {
    if (!lastBackup) return;
    try {
      await unwrap(window.api.shell.reveal(lastBackup));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open folder');
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      await unwrap(window.api.backup.restore({}));
      // On success the app relaunches; this rarely returns.
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) {
        setBusy(null);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Restore failed');
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-accent" /> Backup &amp; Restore
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Backups use SQLite&rsquo;s safe online backup with an integrity manifest. Restore captures
          your current invoice-number high-water mark first, so numbers issued after an older backup
          are never reused — the app reconciles and relaunches automatically.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void backup()} disabled={busy !== null}>
            <Download className="h-4 w-4" /> {busy === 'backup' ? 'Backing up…' : 'Create Backup'}
          </Button>
          <Button variant="outline" onClick={() => void restore()} disabled={busy !== null}>
            <Upload className="h-4 w-4" /> {busy === 'restore' ? 'Restoring…' : 'Restore Backup'}
          </Button>
        </div>

        {lastBackup && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium text-success">Last backup saved to:</p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={lastBackup}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 font-mono text-xs"
              />
              <Button variant="outline" size="sm" onClick={() => void copyPath()}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openFolder()}>
                <FolderOpen className="h-3.5 w-3.5" /> Open Folder
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AppLockCard() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [pinLength, setPinLength] = useState(4);
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    const res = await window.api.appLock.getStatus();
    if (res.ok) {
      setEnabled(res.data.enabled);
      setPinLength(res.data.length || 4);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(newPin)) {
      toast.error('PIN must be 4 to 8 digits');
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.appLock.setPin(newPin);
      if (res.ok) {
        toast.success('Security PIN lock updated');
        setNewPin('');
        void loadStatus();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Disable PIN screen lock for this application?')) return;
    setBusy(true);
    try {
      const res = await window.api.appLock.disable();
      if (res.ok) {
        toast.info('PIN screen lock disabled');
        void loadStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" /> App Security &amp; PIN Lock
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Protect sensitive customer rate cards, bills and cash statements with a quick offline PIN lock.
          When enabled, the app asks for this PIN upon launch or reload.
        </p>

        <div className="flex items-center justify-between rounded-md border border-border p-3 bg-muted/20">
          <div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              PIN Lock Status: {enabled ? 'Enabled' : 'Disabled'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? `Protected with ${pinLength}-digit PIN`
                : 'Anyone using this computer can view invoices and cash balance'}
            </div>
          </div>
          {enabled && (
            <Button variant="danger" size="sm" onClick={() => void handleDisable()} disabled={busy}>
              Disable PIN Lock
            </Button>
          )}
        </div>

        <form onSubmit={(e) => void handleSetPin(e)} className="space-y-3 pt-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {enabled ? 'Change Security PIN' : 'Set New Security PIN'}
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="password"
              inputMode="numeric"
              placeholder="Enter 4 to 8 digit PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="w-56 font-mono text-center tracking-widest text-lg"
              maxLength={8}
            />
            <Button type="submit" variant="primary" disabled={busy || newPin.length < 4}>
              {enabled ? 'Update PIN' : 'Enable PIN Lock'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
