import { useState } from 'react';
import { Columns3, ChevronUp, ChevronDown, RotateCcw, Lock } from 'lucide-react';
import { Button } from './ui';
import type { ColumnPrefs } from '../lib/useColumnPrefs';

/**
 * "Select Columns to Display" popover — per-table show/hide + reorder toggles,
 * backed by a useColumnPrefs instance. Locked columns show a lock and can't be
 * hidden or moved.
 */
export function ColumnChooser({ prefs }: { prefs: ColumnPrefs }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="h-4 w-4" /> Columns
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-card">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Select Columns to Display
              </span>
              <button
                onClick={prefs.reset}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="Reset to defaults"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {prefs.all.map((col, i) => (
                <li key={col.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <div className="flex flex-col">
                    <button
                      disabled={col.locked || i === 0}
                      onClick={() => prefs.move(col.key, 'up')}
                      className="text-muted-foreground/60 hover:text-foreground disabled:opacity-25"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      disabled={col.locked || i === prefs.all.length - 1}
                      onClick={() => prefs.move(col.key, 'down')}
                      className="text-muted-foreground/60 hover:text-foreground disabled:opacity-25"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="flex-1 text-sm">{col.label}</span>
                  {col.locked ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
                  ) : (
                    <button
                      role="switch"
                      aria-checked={col.visible}
                      onClick={() => prefs.toggle(col.key)}
                      className={[
                        'relative h-5 w-9 rounded-full transition-colors',
                        col.visible ? 'bg-accent' : 'bg-muted-foreground/30',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                          col.visible ? 'translate-x-4' : 'translate-x-0.5',
                        ].join(' ')}
                      />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
