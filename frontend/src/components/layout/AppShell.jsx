import { useState } from 'react';
import { Outlet } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore.js';
import { Avatar } from '../ui/Avatar.jsx';
import { ThemeToggleButton } from './ThemeToggleButton.jsx';

function LogoutIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 17.5h-3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1h3M13.75 14.17 17.5 10l-3.75-4.17M17.5 10h-10"
      />
    </svg>
  );
}

// Layout shell (task 2) — app frame + navigation. Only the pieces that
// exist regardless of which page is active live here; everything
// route-specific renders through <Outlet />.
//
// PROJECT_SPEC.md M12 task 3 — logout lives here (not ProfilePage) since
// it needs to be reachable from every authenticated screen, not just the
// profile one. authStore.logout() always clears local state even if the
// request fails, so this handler doesn't need its own error branch; the
// button just needs to stay disabled for the (usually brief) round trip
// so a slow network can't make a second click fire concurrently.
export function AppShell() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6">
        <span className="text-md font-semibold tracking-tight text-ink">Chat</span>
        <div className="flex items-center gap-3">
          <ThemeToggleButton />
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label="Log out"
            aria-busy={loggingOut || undefined}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
          {user && <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />}
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
