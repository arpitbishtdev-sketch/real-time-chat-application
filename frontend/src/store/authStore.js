import { create } from 'zustand';

import { getMe } from '../api/users.api.js';
import { login as loginRequest, register as registerRequest, logout as logoutRequest } from '../api/auth.api.js';
import { onAuthExpired } from '../api/client.js';

// FRONTEND.md §6/§4 — the one real store this milestone needs. `status`
// starts 'idle' until App.jsx's initial GET /users/me resolves, so route
// guards can tell "haven't checked yet" apart from "checked, logged out."
export const useAuthStore = create((set) => ({
  user: null,
  status: 'idle', // 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

  async loadCurrentUser() {
    set({ status: 'loading' });
    try {
      const { user } = await getMe();
      set({ user, status: 'authenticated' });
    } catch {
      set({ user: null, status: 'unauthenticated' });
    }
  },

  // login/register deliberately let a rejected ApiError propagate (unlike
  // loadCurrentUser, which swallows it into a status) — the calling form
  // needs the specific code/message/details to render field- or form-level
  // feedback (PROJECT_SPEC.md M12 task 5), not just a boolean outcome.
  async login(credentials) {
    const { user } = await loginRequest(credentials);
    set({ user, status: 'authenticated' });
    return user;
  },

  async register(payload) {
    const { user } = await registerRequest(payload);
    set({ user, status: 'authenticated' });
    return user;
  },

  // Always clears local auth state, even if the server call itself fails
  // (network error, etc.) — the user's intent to leave this device should
  // never get stuck behind a flaky request. See ARCHITECTURE.md §18,
  // "Decision: logout always clears local state."
  async logout() {
    try {
      await logoutRequest();
    } catch {
      // best-effort — local state still clears in `finally` below.
    } finally {
      set({ user: null, status: 'unauthenticated' });
    }
  },

  setAuthenticatedUser(user) {
    set({ user, status: 'authenticated' });
  },

  setUnauthenticated() {
    set({ user: null, status: 'unauthenticated' });
  },
}));

// api/client.js can't import this store directly (auth.api.js already
// imports client.js, so the reverse would be a circular import) — it fires
// a DOM event instead, and the store listens for it here, once, for the
// lifetime of the app.
onAuthExpired(() => useAuthStore.getState().setUnauthenticated());
