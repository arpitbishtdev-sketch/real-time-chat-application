import { create } from 'zustand';

// Empty shell (PROJECT_SPEC.md M11 task 7) — same rationale as
// presenceStore.js. Populated starting M15.
export const useTypingStore = create(() => ({
  typingByConversationId: {},
}));
