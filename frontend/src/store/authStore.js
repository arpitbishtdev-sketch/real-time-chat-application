import { create } from 'zustand';

import { getMe } from '../api/users.api.js';
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
