import { ThemeToggleButton } from './ThemeToggleButton.jsx';

// Shared shell for the two public auth pages — centered card, restrained
// branding. Kept out of AppShell since auth pages have no header/nav, but
// the theme toggle stays reachable here too (see ThemeToggleButton.jsx).
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-surface px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggleButton />
      </div>
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-md font-semibold tracking-tight text-ink">Chat</p>
        <div className="rounded-lg border border-line bg-surface-raised p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <p className="mt-4 text-center text-sm text-ink-muted">{footer}</p>}
      </div>
    </div>
  );
}
