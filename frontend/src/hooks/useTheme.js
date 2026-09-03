import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'theme';

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // Storage can throw in a locked-down environment (private mode, etc.) —
    // falling back to the system preference is a safe, silent degrade.
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

// Small, local piece of UI state — not global app state, so it stays a
// plain hook rather than a Zustand store (FRONTEND.md §4: client/UI state
// doesn't need to be global). Defaults to the OS preference; an explicit
// user choice is persisted and wins over the system preference thereafter.
export function useTheme() {
  const [theme, setTheme] = useState(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (readStoredTheme()) {
      return undefined;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Non-fatal — the toggle still works for the current session.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
