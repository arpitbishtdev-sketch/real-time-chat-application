import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/api/conversations.api.js', () => ({
  getMessages: vi.fn(),
}));

vi.mock('../src/sockets/socketClient.js', () => ({
  socket: { on: vi.fn(), off: vi.fn(), connected: true },
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  emitMessageDelivered: vi.fn(),
}));

import { useSocketConnection } from '../src/hooks/useSocketConnection.js';
import { getMessages } from '../src/api/conversations.api.js';
import { socket } from '../src/sockets/socketClient.js';
import { useAuthStore } from '../src/store/authStore.js';
import { useSocketStore } from '../src/store/socketStore.js';

afterEach(cleanup);

// TESTING.md §6 — "the reconnection sync trigger" is named explicitly as a
// hook-level frontend test target, distinct from the socket-level backend
// tests in socket.reconnection.test.js. ActiveConversation.test.jsx and
// RealtimePresenceTyping.test.jsx both mount useSocketConnection, but every
// one of their 'connect' events fires before any conversation has been
// joined (activeConversationId is still null at that point), so
// resyncActiveConversation has always been a no-op in this suite until now
// — this file is the first to actually exercise the after-cursor fetch and
// cache-merge path itself (TESTING.md #6, REALTIME.md §19).
function handlerFor(event) {
  const call = socket.on.mock.calls.find(([name]) => name === event);
  return call?.[1];
}

function fireConnect() {
  act(() => {
    handlerFor('connect')();
  });
}

function renderConnection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const result = renderHook(() => useSocketConnection(), { wrapper });
  return { ...result, queryClient };
}

function historyPage(messages, overrides = {}) {
  return { pages: [{ messages, nextCursor: null, nextAfter: null, ...overrides }] };
}

describe('useSocketConnection — reconnection resync (TESTING.md #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMessages.mockReset();
    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connecting', activeConversationId: null });
  });

  it('does nothing on connect when no conversation is currently open', () => {
    renderConnection();
    fireConnect();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('does nothing when the open conversation has no cached history to anchor an after-cursor on', () => {
    useSocketStore.setState({ activeConversationId: 'c1' });
    renderConnection();
    fireConnect();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('fetches after the newest cached message and merges missed messages into the cache, newest-first', async () => {
    useSocketStore.setState({ activeConversationId: 'c1' });
    const existing = { _id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'first', createdAt: '2026-01-10T00:00:00Z' };
    const missed = { _id: 'm2', conversationId: 'c1', senderId: 'u2', text: 'missed while offline', createdAt: '2026-01-10T00:01:00Z' };
    getMessages.mockResolvedValueOnce({ messages: [missed], nextAfter: null });

    const { queryClient } = renderConnection();
    queryClient.setQueryData(['messages', 'c1'], historyPage([existing]));
    queryClient.setQueryData(['conversations'], {
      conversations: [{ _id: 'c1', lastMessageAt: existing.createdAt, lastMessagePreview: existing.text }],
    });

    fireConnect();

    await waitFor(() => expect(getMessages).toHaveBeenCalledWith('c1', { after: 'm1' }));

    const merged = queryClient.getQueryData(['messages', 'c1']);
    expect(merged.pages[0].messages.map((m) => m._id)).toEqual(['m2', 'm1']);

    const conversations = queryClient.getQueryData(['conversations']);
    expect(conversations.conversations[0].lastMessageAt).toBe(missed.createdAt);
    expect(conversations.conversations[0].lastMessagePreview).toBe('missed while offline');
  });

  it('never duplicates a message the live message:new listener already inserted before the resync fetch resolved', async () => {
    useSocketStore.setState({ activeConversationId: 'c1' });
    const existing = { _id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'first', createdAt: '2026-01-10T00:00:00Z' };
    const missed = { _id: 'm2', conversationId: 'c1', senderId: 'u2', text: 'raced', createdAt: '2026-01-10T00:01:00Z' };

    let resolveFetch;
    getMessages.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)));

    const { queryClient } = renderConnection();
    queryClient.setQueryData(['messages', 'c1'], historyPage([existing]));

    fireConnect();
    await waitFor(() => expect(getMessages).toHaveBeenCalled());

    // The live message:new handler wins the race and inserts it first.
    act(() => {
      handlerFor('message:new')({ message: missed });
    });

    await act(async () => {
      resolveFetch({ messages: [missed], nextAfter: null });
    });

    const merged = queryClient.getQueryData(['messages', 'c1']);
    expect(merged.pages[0].messages.filter((m) => m._id === 'm2')).toHaveLength(1);
  });

  it('pages through the full missed-message backlog via nextAfter before stopping', async () => {
    useSocketStore.setState({ activeConversationId: 'c1' });
    const existing = { _id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'anchor', createdAt: '2026-01-10T00:00:00Z' };
    const page1msg = { _id: 'm2', conversationId: 'c1', senderId: 'u2', text: 'older missed', createdAt: '2026-01-10T00:01:00Z' };
    const page2msg = { _id: 'm3', conversationId: 'c1', senderId: 'u2', text: 'newest missed', createdAt: '2026-01-10T00:02:00Z' };

    getMessages
      .mockResolvedValueOnce({ messages: [page1msg], nextAfter: 'm2' })
      .mockResolvedValueOnce({ messages: [page2msg], nextAfter: null });

    const { queryClient } = renderConnection();
    queryClient.setQueryData(['messages', 'c1'], historyPage([existing]));

    fireConnect();

    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));
    expect(getMessages).toHaveBeenNthCalledWith(1, 'c1', { after: 'm1' });
    expect(getMessages).toHaveBeenNthCalledWith(2, 'c1', { after: 'm2' });

    const merged = queryClient.getQueryData(['messages', 'c1']);
    expect(merged.pages[0].messages.map((m) => m._id)).toEqual(['m3', 'm2', 'm1']);
  });
});
