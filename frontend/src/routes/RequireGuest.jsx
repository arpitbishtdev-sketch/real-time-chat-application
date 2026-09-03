import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from '../store/authStore.js';

// Symmetric to RequireAuth: an already-authenticated user hitting
// /login or /register is sent to the app instead of seeing a login form
// for an account they're already in.
export function RequireGuest() {
  const status = useAuthStore((state) => state.status);

  if (status === 'idle' || status === 'loading') {
    return null;
  }

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
