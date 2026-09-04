import { describe, it, expect, beforeEach } from 'vitest';

import { useTypingStore } from '../src/store/typingStore.js';

// PROJECT_SPEC.md M15 task 2 — typing state scoped per conversation, and
// explicitly cleared (not just left to expire) when a conversation's room
// is left, so a stale "still typing" entry can never leak into a later
// reopen of the same conversation (no future typing:update can ever arrive
// to self-correct it once the room's been left, REALTIME.md §7).
describe('typingStore', () => {
  beforeEach(() => {
    useTypingStore.setState({ typingByConversationId: {} });
  });

  it("setTyping(true) adds the user to that conversation's typing set", () => {
    useTypingStore.getState().setTyping('c1', 'u2', true);
    expect(useTypingStore.getState().typingByConversationId.c1.has('u2')).toBe(true);
  });

  it("setTyping(false) removes the user from that conversation's typing set", () => {
    useTypingStore.getState().setTyping('c1', 'u2', true);
    useTypingStore.getState().setTyping('c1', 'u2', false);
    expect(useTypingStore.getState().typingByConversationId.c1.has('u2')).toBe(false);
  });

  it('scopes typing state per conversation — no cross-conversation leakage', () => {
    useTypingStore.getState().setTyping('c1', 'u2', true);
    expect(useTypingStore.getState().typingByConversationId.c2).toBeUndefined();
  });

  it('clearConversation removes the entire entry for that conversation', () => {
    useTypingStore.getState().setTyping('c1', 'u2', true);
    useTypingStore.getState().clearConversation('c1');
    expect(useTypingStore.getState().typingByConversationId.c1).toBeUndefined();
  });

  it('clearConversation is a no-op for a conversation with no typing state', () => {
    const before = useTypingStore.getState().typingByConversationId;
    useTypingStore.getState().clearConversation('does-not-exist');
    expect(useTypingStore.getState().typingByConversationId).toBe(before);
  });
});
