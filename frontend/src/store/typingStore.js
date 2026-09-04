import { create } from 'zustand';

// FRONTEND.md §16, PROJECT_SPEC.md M15 task 2 — populated from
// typing:update events (useSocketConnection). Keyed by conversationId, each
// entry a Set<userId> rather than a single boolean/userId pair: conversations
// are strictly 1-to-1 in MVP (FRONTEND.md §17) so in practice this only ever
// holds the one other participant, but a Set means an out-of-order/duplicate
// typing:update (e.g. two rapid starts before a stop) never desyncs into an
// inconsistent single-value state — adding/removing the same id twice is a
// no-op either way.
export const useTypingStore = create((set) => ({
  typingByConversationId: {},

  setTyping(conversationId, userId, isTyping) {
    set((state) => {
      const current = state.typingByConversationId[conversationId];
      const next = new Set(current);
      if (isTyping) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return {
        typingByConversationId: { ...state.typingByConversationId, [conversationId]: next },
      };
    });
  },

  // Called when a conversation's room is left (useConversationRoom) — once
  // this socket leaves `conversation:<id>`, it stops receiving that
  // conversation's typing:update events entirely, so any "still typing"
  // entry left behind would be stale forever rather than self-correcting
  // (no future event can ever clear it). Clearing on leave is what
  // guarantees no stale/leaked typing indicator across a conversation
  // switch (PROJECT_SPEC.md M15 "no cross-conversation leakage").
  clearConversation(conversationId) {
    set((state) => {
      if (!(conversationId in state.typingByConversationId)) return state;
      const next = { ...state.typingByConversationId };
      delete next[conversationId];
      return { typingByConversationId: next };
    });
  },
}));

export function useIsUserTyping(conversationId, userId) {
  return useTypingStore((state) =>
    Boolean(conversationId && userId && state.typingByConversationId[conversationId]?.has(userId))
  );
}
