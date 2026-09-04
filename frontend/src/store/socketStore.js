import { create } from 'zustand';

// FRONTEND.md §9/§13 — the two pieces of socket-related state that need to
// be readable from components with no direct relationship to each other
// (ConnectionBanner, MessageInput's disabled state, ChatHeader) or from
// non-React code (useSocketConnection's imperative event handlers), so a
// small Zustand store earns its place here the same way authStore does —
// not local state duplicated per component.
//
// `status` mirrors ARCHITECTURE.md §12's socket state machine, collapsed
// to what the UI actually distinguishes (FRONTEND.md §13): 'connected'
// (hidden/neutral), 'connecting' (initial handshake), 'reconnecting'
// (dropped, Socket.IO retrying), 'disconnected' (not authenticated / logged
// out / server-initiated disconnect — no automatic retry in flight).
export const useSocketStore = create((set) => ({
  status: 'disconnected',
  activeConversationId: null,

  setStatus(status) {
    set({ status });
  },

  setActiveConversationId(conversationId) {
    set({ activeConversationId: conversationId });
  },

  clearActiveConversationId(conversationId) {
    set((state) =>
      state.activeConversationId === conversationId ? { activeConversationId: null } : state
    );
  },
}));
