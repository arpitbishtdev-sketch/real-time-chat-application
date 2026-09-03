import { useAuthStore } from '../store/authStore.js';

// Thin, ergonomic read of authStore for components that just need to know
// "who's logged in" without pulling in the mutating actions too.
export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  return { user, status, isAuthenticated: status === 'authenticated' };
}
