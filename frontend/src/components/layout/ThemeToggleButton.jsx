import { useTheme } from '../../hooks/useTheme.js';

function SunIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M10 2.5v1.75M10 15.75v1.75M17.5 10h-1.75M4.25 10H2.5M15.3 4.7l-1.24 1.24M5.94 14.06 4.7 15.3M15.3 15.3l-1.24-1.24M5.94 5.94 4.7 4.7"
      />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M17.3 12.6a7 7 0 0 1-9.9-9.9 7.5 7.5 0 1 0 9.9 9.9Z" />
    </svg>
  );
}

// Shared between AppShell (authenticated pages) and AuthLayout (public
// pages) — theme should be reachable from anywhere, not only once logged
// in (task 8's "verified in both modes" implies both modes are actually
// reachable everywhere, not just behind auth).
export function ThemeToggleButton({ className }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={
        className ??
        'flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink'
      }
    >
      {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
