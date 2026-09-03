import { Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/layout/AppShell.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { RegisterPage } from '../pages/RegisterPage.jsx';
import { ChatPage } from '../pages/ChatPage.jsx';
import { ProfilePage } from '../pages/ProfilePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { RequireAuth } from './RequireAuth.jsx';
import { RequireGuest } from './RequireGuest.jsx';

// FRONTEND.md §2 — public auth routes vs. protected app routes, the latter
// wrapped in both RequireAuth (auth check) and AppShell (chrome). A
// specific conversation is a route param so it's linkable/refreshable, not
// just client-side-only state (the conversation view itself is M13).
export function AppRouter() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/conversations/:conversationId" element={<ChatPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
