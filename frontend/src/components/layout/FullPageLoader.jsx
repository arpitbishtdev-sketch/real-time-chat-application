import { Spinner } from '../ui/Spinner.jsx';

// Shown only for the brief window before the initial GET /users/me
// resolves (RequireAuth/RequireGuest's 'idle'/'loading' state) — not a
// general-purpose page-level loading pattern (FRONTEND.md §11 prefers
// skeletons for that).
export function FullPageLoader() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-dvh items-center justify-center bg-surface"
    >
      <Spinner className="h-6 w-6 text-ink-faint" />
    </div>
  );
}
