import {
  LayoutDashboard,
  Users,
  FileText,
  Settings as SettingsIcon,
  Moon,
  Sun,
  ReceiptIndianRupee,
  Plus,
  Package,
  Boxes,
  Truck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from './lib/cn';
import { useTheme } from './lib/theme';
import { ToastProvider } from './components/Toast';
import { Button } from './components/ui';
import { Dashboard } from './screens/Dashboard';
import { Parties } from './screens/Parties';
import { Products } from './screens/Products';
import { ManageStock } from './screens/ManageStock';
import { InvoiceHistory } from './screens/InvoiceHistory';
import { InvoiceEditor } from './screens/InvoiceEditor';
import { ChallanHistory } from './screens/ChallanHistory';
import { ChallanEditor } from './screens/ChallanEditor';
import { Settings } from './screens/Settings';

/**
 * App shell: fixed sidebar navigation + routed content. A tiny in-memory router
 * keeps things simple for a single-window desktop app (no URL routing needed).
 */

export type Route =
  | { name: 'dashboard' }
  | { name: 'customers' }
  | { name: 'products' }
  | { name: 'stock' }
  | { name: 'history' }
  | { name: 'invoice'; id: string }
  | { name: 'challans' }
  | { name: 'challan'; id: string }
  | { name: 'settings' };

type NavItem = { name: Route['name']; label: string; icon: typeof LayoutDashboard };

const BASE_NAV: NavItem[] = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'history', label: 'Invoices', icon: FileText },
  { name: 'challans', label: 'Delivery Challans', icon: Truck },
  { name: 'customers', label: 'Customers / Vendors', icon: Users },
  { name: 'products', label: 'Products / Services', icon: Package },
  { name: 'settings', label: 'Settings', icon: SettingsIcon },
];
const STOCK_NAV: NavItem = { name: 'stock', label: 'Manage Stock', icon: Boxes };

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { dark, toggle } = useTheme();
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [inventoryOn, setInventoryOn] = useState(false);

  // Inventory nav item appears only when the feature is toggled on.
  useEffect(() => {
    void (async () => {
      const r = await window.api.inventory.get();
      if (r.ok) setInventoryOn(Boolean(r.data));
    })();
  }, [route]);

  // Insert Manage Stock right after Products (index of 'products' + 1).
  const nav: NavItem[] = inventoryOn
    ? (() => {
        const i = BASE_NAV.findIndex((n) => n.name === 'products');
        return [...BASE_NAV.slice(0, i + 1), STOCK_NAV, ...BASE_NAV.slice(i + 1)];
      })()
    : BASE_NAV;

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <ReceiptIndianRupee className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight tracking-tight">Moulder</p>
            <p className="text-[11px] text-muted-foreground">GST Billing</p>
          </div>
        </div>

        <div className="px-3">
          <Button
            className="w-full"
            onClick={() => setRoute({ name: 'invoice', id: 'new' })}
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
          <Button
            className="mt-2 w-full"
            variant="outline"
            onClick={() => setRoute({ name: 'challan', id: 'new' })}
          >
            <Truck className="h-4 w-4" />
            New Challan
          </Button>
        </div>

        <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => {
            const active =
              route.name === item.name ||
              (item.name === 'history' && route.name === 'invoice') ||
              (item.name === 'challans' && route.name === 'challan');
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => setRoute({ name: item.name } as Route)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent/12 text-accent'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          {route.name === 'dashboard' && <Dashboard onNavigate={setRoute} />}
          {route.name === 'customers' && <Parties />}
          {route.name === 'products' && <Products />}
          {route.name === 'stock' && <ManageStock />}
          {route.name === 'history' && <InvoiceHistory onOpen={(id) => setRoute({ name: 'invoice', id })} />}
          {route.name === 'invoice' && (
            <InvoiceEditor
              invoiceId={route.id}
              onDone={() => setRoute({ name: 'history' })}
            />
          )}
          {route.name === 'challans' && (
            <ChallanHistory onOpen={(id) => setRoute({ name: 'challan', id })} />
          )}
          {route.name === 'challan' && (
            <ChallanEditor
              challanId={route.id}
              onDone={() => setRoute({ name: 'challans' })}
            />
          )}
          {route.name === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}
