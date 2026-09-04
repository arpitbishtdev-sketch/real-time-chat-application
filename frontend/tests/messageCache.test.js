import { describe, it, expect } from 'vitest';

import {
  insertLiveMessage,
  reconcileOptimisticMessage,
  markOptimisticMessageFailed,
  patchConversationPreview,
  incrementUnreadCount,
  clearUnreadCount,
  applyMessageDeliveredStatus,
  applyMessageReadStatus,
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

// PROJECT_SPEC.md M15 task 6 — live unread-count bookkeeping, kept as pure
// helpers over the ['conversations'] cache shape same as the rest of this
// file, independently composable with patchConversationPreview.
describe('incrementUnreadCount / clearUnreadCount', () => {
  function conversationsData() {
    return {
      conversations: [
        { _id: 'c1', unreadCount: 0 },
        { _id: 'c2', unreadCount: 3 },
      ],
      nextCursor: null,
    };
  }

  it('increments only the matching conversation, defaulting a missing unreadCount to 0', () => {
    const next = incrementUnreadCount(conversationsData(), 'c1');
    expect(next.conversations[0].unreadCount).toBe(1);
    expect(next.conversations[1].unreadCount).toBe(3);
  });

  it('clears the matching conversation to 0 regardless of its prior count', () => {
    const next = clearUnreadCount(conversationsData(), 'c2');
    expect(next.conversations[1].unreadCount).toBe(0);
    expect(next.conversations[0].unreadCount).toBe(0);
  });

  it('both are no-ops when there is no cached list yet', () => {
    expect(incrementUnreadCount(undefined, 'c1')).toBeUndefined();
    expect(clearUnreadCount(undefined, 'c1')).toBeUndefined();
  });
});

// REALTIME.md §17a/§17b — message:status is monotonic (sent < delivered <
// read) and carries two payload shapes; these mirror both rules
// client-side so an out-of-order re-delivery can never regress a tick.
describe('applyMessageDeliveredStatus', () => {
  it('advances the matching message from sent to delivered', () => {
    const data = { pages: [page([{ ...OLD_MESSAGE, _id: 'm5', status: 'sent' }])], pageParams: [undefined] };

    const next = applyMessageDeliveredStatus(data, 'm5');

    expect(next.pages[0].messages[0].status).toBe('delivered');
  });

  it('never regresses a message already at read', () => {
    const data = { pages: [page([{ ...OLD_MESSAGE, _id: 'm5', status: 'read' }])], pageParams: [undefined] };

    const next = applyMessageDeliveredStatus(data, 'm5');

    expect(next.pages[0].messages[0].status).toBe('read');
  });

  it('returns the input unchanged when there is no cached data yet', () => {
    expect(applyMessageDeliveredStatus(undefined, 'm5')).toBeUndefined();
  });
});

describe('applyMessageReadStatus', () => {
  const cursor = {
    _id: 'm-cursor',
    conversationId: 'c1',
    senderId: 'u2',
    text: 'seen this',
    status: 'sent',
    createdAt: '2026-01-10T00:05:00Z',
  };

  it('marks every message this user sent at or before the cursor as read', () => {
    const older = { ...OLD_MESSAGE, _id: 'm-older', senderId: 'me', createdAt: '2026-01-10T00:02:00Z', status: 'sent' };
    const newer = { ...OLD_MESSAGE, _id: 'm-newer', senderId: 'me', createdAt: '2026-01-10T00:06:00Z', status: 'sent' };
    const data = { pages: [page([newer, cursor, older])], pageParams: [undefined] };

    const next = applyMessageReadStatus(data, 'm-cursor', 'me');

    const byId = Object.fromEntries(next.pages[0].messages.map((m) => [m._id, m]));
    expect(byId['m-older'].status).toBe('read');
    expect(byId['m-newer'].status).toBe('sent'); // newer than the cursor — not yet covered
  });

  it('never touches messages sent by someone else', () => {
    const theirs = { ...OLD_MESSAGE, _id: 'm-theirs', senderId: 'u2', createdAt: '2026-01-10T00:01:00Z', status: 'sent' };
    const data = { pages: [page([cursor, theirs])], pageParams: [undefined] };

    const next = applyMessageReadStatus(data, 'm-cursor', 'me');

    expect(next.pages[0].messages.find((m) => m._id === 'm-theirs').status).toBe('sent');
  });

  it('is a no-op when the cursor message is not in any loaded page', () => {
    const mine = { ...OLD_MESSAGE, _id: 'm-mine', senderId: 'me', status: 'sent' };
    const data = { pages: [page([mine])], pageParams: [undefined] };

    const next = applyMessageReadStatus(data, 'does-not-exist', 'me');

    expect(next.pages[0].messages[0].status).toBe('sent');
  });

  it('returns the input unchanged when there is no cached data yet', () => {
    expect(applyMessageReadStatus(undefined, 'm-cursor', 'me')).toBeUndefined();
  });
});
