import { Outlet } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore.js';
import { Avatar } from '../ui/Avatar.jsx';
import { ThemeToggleButton } from './ThemeToggleButton.jsx';

// Layout shell (task 2) — app frame + navigation. Only the pieces that
// exist regardless of which page is active live here; everything
// route-specific renders through <Outlet />.
export function AppShell() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6">
        <span className="text-md font-semibold tracking-tight text-ink">Chat</span>
        <div className="flex items-center gap-3">
          <ThemeToggleButton />
          {user && <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />}
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
