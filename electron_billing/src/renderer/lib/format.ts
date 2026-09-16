/** Renderer-side display helpers (no money math — that stays in the engine). */

/** Format a decimal string as Indian-grouped currency (e.g. "12,280.00"). */
export function formatMoneyString(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const [wholeRaw, fracRaw = '00'] = abs.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const grouped = groupIndian(wholeRaw);
  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const parts: string[] = [];
  let rest = head;
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  parts.unshift(rest);
  return `${parts.join(',')},${tail}`;
}

/** Prefix a rupee symbol. */
export function rupees(value: string | null | undefined): string {
  return `\u20B9${formatMoneyString(value)}`;
}

/** Format an ISO date (yyyy-mm-dd) as a readable date, or em dash if empty. */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Today as yyyy-mm-dd in local time (for date inputs). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
