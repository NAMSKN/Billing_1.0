import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Per-table column preferences (visibility + order), persisted in localStorage.
 * A display-only concern — no backend. Locked columns are always visible and
 * are pinned to the front in their declared order (e.g. Name, Actions).
 */

export interface ColumnDef {
  key: string;
  label: string;
  /** Shown by default when the user has no saved preference. */
  defaultVisible?: boolean;
  /** Always visible; cannot be toggled off or reordered away. */
  locked?: boolean;
}

interface StoredPrefs {
  order: string[];
  hidden: string[];
}

function storageKey(tableKey: string): string {
  return `columns:${tableKey}`;
}

function loadStored(tableKey: string): StoredPrefs | null {
  try {
    const raw = localStorage.getItem(storageKey(tableKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPrefs;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface ColumnPrefs {
  /** Columns to render, in order (locked first, then user order). */
  visible: ColumnDef[];
  /** All columns with their current visibility, for the chooser UI. */
  all: (ColumnDef & { visible: boolean })[];
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  move: (key: string, direction: 'up' | 'down') => void;
  reset: () => void;
}

export function useColumnPrefs(tableKey: string, columns: ColumnDef[]): ColumnPrefs {
  const lockedKeys = useMemo(
    () => columns.filter((c) => c.locked).map((c) => c.key),
    [columns],
  );
  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const [prefs, setPrefs] = useState<StoredPrefs>(() => {
    const stored = loadStored(tableKey);
    if (stored) {
      // Reconcile against the current column catalogue (columns may have been
      // added/removed since the preference was saved).
      const known = new Set(columns.map((c) => c.key));
      const order = stored.order.filter((k) => known.has(k));
      for (const c of columns) if (!order.includes(c.key)) order.push(c.key);
      const hidden = stored.hidden.filter((k) => known.has(k) && !lockedKeys.includes(k));
      return { order, hidden };
    }
    return {
      order: columns.map((c) => c.key),
      hidden: columns.filter((c) => c.defaultVisible === false && !c.locked).map((c) => c.key),
    };
  });

  useEffect(() => {
    localStorage.setItem(storageKey(tableKey), JSON.stringify(prefs));
  }, [tableKey, prefs]);

  const isVisible = useCallback((key: string) => !prefs.hidden.includes(key), [prefs.hidden]);

  const toggle = useCallback(
    (key: string) => {
      if (lockedKeys.includes(key)) return;
      setPrefs((p) => ({
        ...p,
        hidden: p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key],
      }));
    },
    [lockedKeys],
  );

  const move = useCallback(
    (key: string, direction: 'up' | 'down') => {
      if (lockedKeys.includes(key)) return;
      setPrefs((p) => {
        // Reorder only within the non-locked segment.
        const movable = p.order.filter((k) => !lockedKeys.includes(k));
        const idx = movable.indexOf(key);
        const target = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || target < 0 || target >= movable.length) return p;
        [movable[idx], movable[target]] = [movable[target], movable[idx]];
        return { ...p, order: [...lockedKeys, ...movable] };
      });
    },
    [lockedKeys],
  );

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey(tableKey));
    setPrefs({
      order: columns.map((c) => c.key),
      hidden: columns.filter((c) => c.defaultVisible === false && !c.locked).map((c) => c.key),
    });
  }, [tableKey, columns]);

  // Ordered: locked columns first (declared order), then user-ordered rest.
  const orderedKeys = useMemo(() => {
    const rest = prefs.order.filter((k) => !lockedKeys.includes(k));
    return [...lockedKeys, ...rest];
  }, [prefs.order, lockedKeys]);

  const all = useMemo(
    () =>
      orderedKeys
        .map((k) => byKey.get(k))
        .filter((c): c is ColumnDef => Boolean(c))
        .map((c) => ({ ...c, visible: isVisible(c.key) })),
    [orderedKeys, byKey, isVisible],
  );

  const visible = useMemo(() => all.filter((c) => c.visible), [all]);

  return { visible, all, isVisible, toggle, move, reset };
}
