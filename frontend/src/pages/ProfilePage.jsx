import { useAuthStore } from '../store/authStore.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

// Structural placeholder — displays the real authenticated user (already
// available from M11's authStore), but no editing yet. Skeleton fallback
// covers the (normally brief) window before the initial GET /users/me
// resolves, since RequireAuth only blocks unauthenticated access, not the
// loading state itself for an already-known-authenticated session.
export function ProfilePage() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 overflow-y-auto px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">Profile</h1>
      <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-raised p-5">
        {user ? (
          <>
            <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
            <div>
              <p className="text-md font-medium text-ink">{user.displayName}</p>
              <p className="text-sm text-ink-muted">{user.email}</p>
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
