import { useEffect, useState } from 'react';

/** Light/dark theme toggle persisted in localStorage; defaults to light. */
export function useTheme() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
