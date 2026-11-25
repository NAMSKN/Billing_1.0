import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { PartyDto, PartyAddressDto, PartyGroupDto } from '@shared/partyDto';
import {
  PartyType,
  RegistrationType,
  BalanceType,
  PARTY_TYPE_LABEL,
  REGISTRATION_TYPE_LABEL,
  BALANCE_TYPE_LABEL,
  INDIA,
} from '@shared/domain/party';
import { unwrap, ApiError } from '../lib/api';
import { Button, Field, Input, Select, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { StateSelect } from '../components/StateSelect';
import { useToast } from '../components/Toast';

function emptyAddress(): PartyAddressDto {
  return {
    address1: '',
    address2: '',
    landmark: '',
    country: INDIA,
    state: '',
    state_code: '',
    city: '',
    pincode: '',
  };
}

export function emptyParty(): PartyDto {
  return {
    id: '',
    company_type: PartyType.CUSTOMER,
    company_name: '',
    contact_person: '',
    contact_no: '',
    email: '',
    registration_type: RegistrationType.UNREGISTERED,
    gstin: '',
    pan: '',
    billing_address: emptyAddress(),
    shipping_address: null,
    distance_for_eway_bill_km: null,
    group_id: null,
    bank_name: '',
    bank_ifsc_code: '',
    bank_account_number: '',
    fax_no: '',
    website: '',
    credit_limit: null,
    due_days: null,
    note: '',
    visible_on_documents: false,
    custom_field_1: '',
    custom_field_2: '',
    custom_field_3: '',
    customer_balance: { balance_type: BalanceType.DEBIT, amount: '0.00' },
    vendor_balance: { balance_type: BalanceType.DEBIT, amount: '0.00' },
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function PartyEditor({
  party,
  onClose,
  onSaved,
}: {
  party: PartyDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<PartyDto>(party);
  const [groups, setGroups] = useState<PartyGroupDto[]>([]);
  const [sameAsBilling, setSameAsBilling] = useState(party.shipping_address === null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setGroups(await unwrap<PartyGroupDto[]>(window.api.parties.groupList()));
      } catch {
        /* groups are optional */
      }
    })();
  }, []);

  const set = (patch: Partial<PartyDto>) => setDraft((d) => ({ ...d, ...patch }));
  const setBill = (patch: Partial<PartyAddressDto>) =>
    setDraft((d) => ({ ...d, billing_address: { ...d.billing_address, ...patch } }));
  const setShip = (patch: Partial<PartyAddressDto>) =>
    setDraft((d) => ({
      ...d,
      shipping_address: { ...(d.shipping_address ?? emptyAddress()), ...patch },
    }));

  const addGroup = async () => {
    const name = window.prompt('Group name:');
    if (!name || !name.trim()) return;
    try {
      const g = await unwrap<PartyGroupDto>(window.api.parties.groupCreate(name.trim()));
      setGroups((prev) => [...prev, g]);
      set({ group_id: g.id });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create group');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: PartyDto = {
        ...draft,
        shipping_address: sameAsBilling ? null : (draft.shipping_address ?? emptyAddress()),
      };
      await unwrap(window.api.parties.save(payload));
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const isIndia = draft.billing_address.country.trim().toLowerCase() === INDIA.toLowerCase();

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={party.id ? 'Edit Customer / Vendor' : 'Add Customer / Vendor'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Section title="Basic Information">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Type *">
              <Select
                value={draft.company_type}
                onChange={(e) => set({ company_type: e.target.value as PartyType })}
              >
                {Object.values(PartyType).map((t) => (
                  <option key={t} value={t}>
                    {PARTY_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="GSTIN">
              <Input
                value={draft.gstin}
                onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                placeholder="15-char GSTIN, entered manually (no auto-fill)"
              />
            </Field>
            <Field label="Company Name *" className="col-span-2">
              <Input value={draft.company_name} onChange={(e) => set({ company_name: e.target.value })} autoFocus />
            </Field>
            <Field label="Contact Person">
              <Input value={draft.contact_person} onChange={(e) => set({ contact_person: e.target.value })} />
            </Field>
            <Field label="Contact No">
              <Input value={draft.contact_no} onChange={(e) => set({ contact_no: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input value={draft.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Registration Type">
              <Select
                value={draft.registration_type}
                onChange={(e) => set({ registration_type: e.target.value as RegistrationType })}
              >
                {Object.values(RegistrationType).map((t) => (
                  <option key={t} value={t}>
                    {REGISTRATION_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="PAN">
              <Input value={draft.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
            </Field>
          </div>
        </Section>

        <Section title="Billing Address">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Address" className="col-span-2">
              <Input value={draft.billing_address.address1} onChange={(e) => setBill({ address1: e.target.value })} />
            </Field>
            <Field label="Address (line 2)" className="col-span-2">
              <Input value={draft.billing_address.address2} onChange={(e) => setBill({ address2: e.target.value })} />
            </Field>
            <Field label="Landmark">
              <Input value={draft.billing_address.landmark} onChange={(e) => setBill({ landmark: e.target.value })} />
            </Field>
            <Field label="Country *">
              <Select
                value={draft.billing_address.country}
                onChange={(e) => setBill({ country: e.target.value })}
              >
                <option value={INDIA}>India</option>
                <option value="Other">Other</option>
              </Select>
            </Field>
            <Field label={isIndia ? 'State *' : 'State'}>
              <StateSelect
                code={draft.billing_address.state_code}
                onChange={(state_code, state) => setBill({ state_code, state })}
              />
            </Field>
            <Field label="City *">
              <Input value={draft.billing_address.city} onChange={(e) => setBill({ city: e.target.value })} />
            </Field>
            <Field label="Pincode">
              <Input value={draft.billing_address.pincode} onChange={(e) => setBill({ pincode: e.target.value })} />
            </Field>
            <Field label="Distance for E-Way Bill (Km)">
              <Input
                value={draft.distance_for_eway_bill_km ?? ''}
                onChange={(e) => set({ distance_for_eway_bill_km: e.target.value || null })}
                placeholder="Optional"
                inputMode="decimal"
              />
            </Field>
          </div>
        </Section>

        <Section title="Shipping Address">
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sameAsBilling}
              onChange={(e) => setSameAsBilling(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Same as Billing Address
          </label>
          {!sameAsBilling && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Address" className="col-span-2">
                <Input value={draft.shipping_address?.address1 ?? ''} onChange={(e) => setShip({ address1: e.target.value })} />
              </Field>
              <Field label="Address (line 2)" className="col-span-2">
                <Input value={draft.shipping_address?.address2 ?? ''} onChange={(e) => setShip({ address2: e.target.value })} />
              </Field>
              <Field label="Landmark">
                <Input value={draft.shipping_address?.landmark ?? ''} onChange={(e) => setShip({ landmark: e.target.value })} />
              </Field>
              <Field label="State">
                <StateSelect
                  code={draft.shipping_address?.state_code ?? ''}
                  onChange={(state_code, state) => setShip({ state_code, state })}
                />
              </Field>
              <Field label="City">
                <Input value={draft.shipping_address?.city ?? ''} onChange={(e) => setShip({ city: e.target.value })} />
              </Field>
              <Field label="Pincode">
                <Input value={draft.shipping_address?.pincode ?? ''} onChange={(e) => setShip({ pincode: e.target.value })} />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Group">
          <div className="flex items-end gap-2">
            <Field label="Customer / Vendor Group" className="flex-1">
              <Select
                value={draft.group_id ?? ''}
                onChange={(e) => set({ group_id: e.target.value || null })}
              >
                <option value="">— No Group —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" size="md" onClick={() => void addGroup()}>
              <Plus className="h-4 w-4" /> Add Group
            </Button>
          </div>
        </Section>

        <Section title="Opening Balance">
          <p className="mb-3 text-xs text-muted-foreground">
            Debit = the party owes you; Credit = you owe the party. Amounts default to ₹0.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer Balance Type">
              <Select
                value={draft.customer_balance.balance_type}
                onChange={(e) =>
                  set({
                    customer_balance: {
                      ...draft.customer_balance,
                      balance_type: e.target.value as BalanceType,
                    },
                  })
                }
              >
                {Object.values(BalanceType).map((t) => (
                  <option key={t} value={t}>
                    {BALANCE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Customer Balance Amount">
              <Input
                value={draft.customer_balance.amount}
                onChange={(e) =>
                  set({ customer_balance: { ...draft.customer_balance, amount: e.target.value } })
                }
                inputMode="decimal"
              />
            </Field>
            <Field label="Vendor Balance Type">
              <Select
                value={draft.vendor_balance.balance_type}
                onChange={(e) =>
                  set({
                    vendor_balance: {
                      ...draft.vendor_balance,
                      balance_type: e.target.value as BalanceType,
                    },
                  })
                }
              >
                {Object.values(BalanceType).map((t) => (
                  <option key={t} value={t}>
                    {BALANCE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor Balance Amount">
              <Input
                value={draft.vendor_balance.amount}
                onChange={(e) =>
                  set({ vendor_balance: { ...draft.vendor_balance, amount: e.target.value } })
                }
                inputMode="decimal"
              />
            </Field>
          </div>
        </Section>

        <Section title="Bank Details">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Bank Name">
              <Input value={draft.bank_name} onChange={(e) => set({ bank_name: e.target.value })} />
            </Field>
            <Field label="Bank IFSC Code">
              <Input value={draft.bank_ifsc_code} onChange={(e) => set({ bank_ifsc_code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Bank Account Number">
              <Input value={draft.bank_account_number} onChange={(e) => set({ bank_account_number: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="Additional Details (all optional)">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fax No">
              <Input value={draft.fax_no} onChange={(e) => set({ fax_no: e.target.value })} />
            </Field>
            <Field label="Website">
              <Input value={draft.website} onChange={(e) => set({ website: e.target.value })} />
            </Field>
            <Field label="Credit Limit">
              <Input
                value={draft.credit_limit ?? ''}
                onChange={(e) => set({ credit_limit: e.target.value || null })}
                inputMode="decimal"
              />
            </Field>
            <Field label="Due Days">
              <Input
                value={draft.due_days ?? ''}
                onChange={(e) => set({ due_days: e.target.value ? Number(e.target.value) : null })}
                inputMode="numeric"
              />
            </Field>
            <Field label="Note" className="col-span-2">
              <Textarea value={draft.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
            <Field label="Custom Field 1">
              <Input value={draft.custom_field_1} onChange={(e) => set({ custom_field_1: e.target.value })} />
            </Field>
            <Field label="Custom Field 2">
              <Input value={draft.custom_field_2} onChange={(e) => set({ custom_field_2: e.target.value })} />
            </Field>
            <Field label="Custom Field 3" className="col-span-2">
              <Input value={draft.custom_field_3} onChange={(e) => set({ custom_field_3: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="Document Visibility">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.visible_on_documents}
              onChange={(e) => set({ visible_on_documents: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            Company will be visible on all documents.
          </label>
        </Section>
      </div>
    </Modal>
  );
}
