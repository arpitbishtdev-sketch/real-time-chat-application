import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/authStore.js';
import { FullPageLoader } from '../components/layout/FullPageLoader.jsx';

// PROJECT_SPEC.md M11 task 1 / acceptance criterion: visiting a protected
// route while unauthenticated redirects to /login. `status` distinguishes
// "haven't checked yet" (idle/loading, from the initial GET /users/me in
// App.jsx) from a confirmed "unauthenticated" — redirecting before that
// initial check resolves would bounce an actually-logged-in user to
// /login on every page load.
export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return <FullPageLoader />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
