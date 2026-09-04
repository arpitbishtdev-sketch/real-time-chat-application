import { describe, it, expect } from 'vitest';

import {
  insertLiveMessage,
  reconcileOptimisticMessage,
  markOptimisticMessageFailed,
  patchConversationPreview,
} from '../src/utils/messageCache.js';

// FRONTEND.md §8 — a live message:new event is appended into the existing
// useMessages cache at the front of the newest page (pages[0] holds the
// newest batch, and within a page messages are newest-first), never as a
// parallel array. These are pure functions over the exact { pages: [...] }
// shape useInfiniteQuery stores, kept free of React/TanStack so the
// merge/reconcile/dedupe logic is unit-testable on its own.

function page(messages, overrides = {}) {
  return { messages, nextCursor: null, nextAfter: null, ...overrides };
}

const OLD_MESSAGE = {
  _id: 'm1',
  conversationId: 'c1',
  senderId: 'u2',
  text: 'hi',
  status: 'sent',
  createdAt: '2026-01-10T00:01:00Z',
};

describe('insertLiveMessage', () => {
  it('prepends a new message to the newest (first) page', () => {
    const data = { pages: [page([OLD_MESSAGE])], pageParams: [undefined] };
    const incoming = { ...OLD_MESSAGE, _id: 'm2', text: 'newer', createdAt: '2026-01-10T00:02:00Z' };

    const next = insertLiveMessage(data, incoming);

    expect(next.pages[0].messages).toEqual([incoming, OLD_MESSAGE]);
  });

  it('does not duplicate a message whose _id already exists in the cache', () => {
    const data = { pages: [page([OLD_MESSAGE])], pageParams: [undefined] };

    const next = insertLiveMessage(data, OLD_MESSAGE);

    expect(next.pages[0].messages).toEqual([OLD_MESSAGE]);
  });

  it('returns the input unchanged when there is no cached data yet', () => {
    expect(insertLiveMessage(undefined, OLD_MESSAGE)).toBeUndefined();
  });
});

describe('reconcileOptimisticMessage', () => {
  it('replaces the pending entry matching clientMessageId with the persisted message', () => {
    const pending = {
      _id: 'temp-1',
      clientMessageId: 'temp-1',
      conversationId: 'c1',
      senderId: 'u1',
      text: 'hello',
      status: 'sending',
      createdAt: '2026-01-10T00:03:00Z',
    };
    const data = { pages: [page([pending])], pageParams: [undefined] };
    const persisted = {
      _id: 'm3',
      conversationId: 'c1',
      senderId: 'u1',
      text: 'hello',
      status: 'sent',
      createdAt: '2026-01-10T00:03:01Z',
    };

    const next = reconcileOptimisticMessage(data, 'temp-1', persisted);

    expect(next.pages[0].messages).toEqual([{ ...persisted, clientMessageId: 'temp-1' }]);
  });

  it('is a no-op when no pending entry matches the clientMessageId', () => {
    const data = { pages: [page([OLD_MESSAGE])], pageParams: [undefined] };

    const next = reconcileOptimisticMessage(data, 'does-not-exist', OLD_MESSAGE);

    expect(next.pages[0].messages).toEqual([OLD_MESSAGE]);
  });
});

describe('markOptimisticMessageFailed', () => {
  it('flips the matching pending entry to failed status', () => {
    const pending = {
      _id: 'temp-1',
      clientMessageId: 'temp-1',
      conversationId: 'c1',
      senderId: 'u1',
      text: 'hello',
      status: 'sending',
      createdAt: '2026-01-10T00:03:00Z',
    };
    const data = { pages: [page([pending])], pageParams: [undefined] };

    const next = markOptimisticMessageFailed(data, 'temp-1');

    expect(next.pages[0].messages[0]).toMatchObject({ clientMessageId: 'temp-1', status: 'failed' });
  });
});

describe('patchConversationPreview', () => {
  // FRONTEND.md §7 — a live message:new for the active conversation
  // surgically updates that conversation's list entry instead of
  // triggering a full refetch of ['conversations'].
  it('updates lastMessageAt/lastMessagePreview for the matching conversation only', () => {
    const data = {
      conversations: [
        { _id: 'c1', lastMessageAt: '2026-01-01T00:00:00Z', lastMessagePreview: 'old', unreadCount: 0 },
        { _id: 'c2', lastMessageAt: '2026-01-05T00:00:00Z', lastMessagePreview: 'other', unreadCount: 2 },
      ],
      nextCursor: null,
    };

    const next = patchConversationPreview(data, 'c1', {
      lastMessageAt: '2026-01-10T00:03:00Z',
      lastMessagePreview: 'hello',
    });

    expect(next.conversations[0]).toMatchObject({
      _id: 'c1',
      lastMessageAt: '2026-01-10T00:03:00Z',
      lastMessagePreview: 'hello',
      unreadCount: 0,
    });
    expect(next.conversations[1]).toEqual(data.conversations[1]);
  });

  it('returns the input unchanged when there is no cached list yet', () => {
    expect(patchConversationPreview(undefined, 'c1', { lastMessageAt: '', lastMessagePreview: '' })).toBeUndefined();
  });
});
