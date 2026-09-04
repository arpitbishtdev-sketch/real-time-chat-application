import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../src/api/conversations.api.js', () => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
}));

vi.mock('../src/sockets/socketClient.js', () => ({
  socket: { on: vi.fn(), off: vi.fn(), connected: true },
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  sendMessage: vi.fn(),
  joinConversation: vi.fn(),
  leaveConversation: vi.fn(),
  emitTypingStart: vi.fn(),
  emitTypingStop: vi.fn(),
  emitMessageDelivered: vi.fn(),
  emitMessageRead: vi.fn(),
}));

import { ActiveConversation } from '../src/components/chat/ActiveConversation.jsx';
import { useSocketConnection } from '../src/hooks/useSocketConnection.js';
import { getConversations, getMessages } from '../src/api/conversations.api.js';
import {
  socket,
  joinConversation,
  emitMessageDelivered,
  emitMessageRead,
} from '../src/sockets/socketClient.js';
import { useAuthStore } from '../src/store/authStore.js';
import { useSocketStore } from '../src/store/socketStore.js';
import { usePresenceStore } from '../src/store/presenceStore.js';
import { useTypingStore } from '../src/store/typingStore.js';

afterEach(cleanup);

// PROJECT_SPEC.md M15 — presence/typing/read-receipt/unread UI, layered on
// M14's live messaging. useSocketConnection owns every global listener
// (presence:*, typing:update, message:status, message:new), so it's
// mounted alongside ActiveConversation here (unlike some of M14's own
// tests, every scenario below needs at least one of those listeners).
function Harness({ conversationId }) {
  useSocketConnection();
  return <ActiveConversation conversationId={conversationId} />;
}

const OTHER = { _id: 'u2', displayName: 'Grace Hopper', avatarUrl: null };

function conversation(overrides = {}) {
  return {
    _id: 'c1',
    otherParticipant: OTHER,
    lastMessageAt: null,
    lastMessagePreview: null,
    unreadCount: 0,
    ...overrides,
  };
}

function emptyHistory() {
  return { messages: [], nextCursor: null, nextAfter: null };
}

function handlerFor(event) {
  const call = socket.on.mock.calls.find(([name]) => name === event);
  return call?.[1];
}

// useSocketConnection's own effect (mounted via Harness) unconditionally
// sets status to 'connecting' on mount, overriding any seeded 'connected'
// state (same caveat ActiveConversation.test.jsx documents) — every
// scenario here needs the real 'connected' transition, including its
// side effects (useConversationRoom's join, useReadReceipts becoming
// eligible), so renderHarness drives it through the mocked socket's
// 'connect' event exactly as a real handshake completing would.
function renderHarness(conversationId, conversations = [conversation()]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  getConversations.mockResolvedValue({ conversations, nextCursor: null });
  const result = render(<Harness conversationId={conversationId} />, { wrapper: Wrapper });
  act(() => {
    handlerFor('connect')();
  });
  return { ...result, queryClient };
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Presence UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinConversation.mockResolvedValue({ ok: true });
    getMessages.mockResolvedValue(emptyHistory());
    usePresenceStore.setState({ onlineUserIds: new Set(), lastSeenByUserId: {} });
    useTypingStore.setState({ typingByConversationId: {} });
    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connected', activeConversationId: null });
    setVisibility('visible');
  });

  it('shows Online once a presence:online event names this contact, and last-seen after presence:offline', async () => {
    renderHarness('c1');
    await screen.findByText('Grace Hopper');

    // Initially unknown → renders the neutral "Offline" fallback copy
    // (presenceStore.js — no REST lastSeenAt and no live event yet).
    expect(await screen.findByText('Offline')).toBeInTheDocument();

    await act(async () => {
      handlerFor('presence:online')({ userId: 'u2' });
    });
    expect(await screen.findByText('Online')).toBeInTheDocument();

    await act(async () => {
      handlerFor('presence:offline')({ userId: 'u2', lastSeenAt: '2026-01-10T00:00:00Z' });
    });
    expect(await screen.findByText(/Last seen/)).toBeInTheDocument();
  });

  it('seeds an initial last-seen label from the REST conversation payload', async () => {
    renderHarness('c1', [conversation({ otherParticipant: { ...OTHER, lastSeenAt: '2026-01-09T00:00:00Z' } })]);

    expect(await screen.findByText(/Last seen/)).toBeInTheDocument();
  });
});

describe('Typing indicator UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinConversation.mockResolvedValue({ ok: true });
    getMessages.mockResolvedValue(emptyHistory());
    usePresenceStore.setState({ onlineUserIds: new Set(), lastSeenByUserId: {} });
    useTypingStore.setState({ typingByConversationId: {} });
    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connected', activeConversationId: null });
    setVisibility('visible');
  });

  it('shows and hides "X is typing…" for the active conversation only', async () => {
    renderHarness('c1');
    await screen.findByText('Grace Hopper');

    await act(async () => {
      handlerFor('typing:update')({ conversationId: 'c1', userId: 'u2', isTyping: true });
    });
    expect(await screen.findByText('Grace Hopper is typing…')).toBeInTheDocument();

    await act(async () => {
      handlerFor('typing:update')({ conversationId: 'c1', userId: 'u2', isTyping: false });
    });
    await waitFor(() => expect(screen.queryByText('Grace Hopper is typing…')).not.toBeInTheDocument());
  });

  it('ignores a typing:update for a conversation that is not the one open', async () => {
    renderHarness('c1');
    await screen.findByText('Grace Hopper');

    await act(async () => {
      handlerFor('typing:update')({ conversationId: 'some-other-conversation', userId: 'u2', isTyping: true });
    });

    expect(screen.queryByText('Grace Hopper is typing…')).not.toBeInTheDocument();
  });
});

describe('Read receipts and unread counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinConversation.mockResolvedValue({ ok: true });
    usePresenceStore.setState({ onlineUserIds: new Set(), lastSeenByUserId: {} });
    useTypingStore.setState({ typingByConversationId: {} });
    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connected', activeConversationId: null });
    setVisibility('visible');
  });

  it('emits message:read for the newest message from the other participant, then clears unreadCount on ack', async () => {
    const incoming = {
      _id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      text: 'hi there',
      status: 'sent',
      createdAt: '2026-01-10T00:00:00Z',
    };
    getMessages.mockResolvedValue({ messages: [incoming], nextCursor: null, nextAfter: null });
    emitMessageRead.mockResolvedValue({ ok: true });

    const { queryClient } = renderHarness('c1', [conversation({ unreadCount: 1 })]);

    await screen.findByText('hi there');
    await waitFor(() => expect(emitMessageRead).toHaveBeenCalledWith('c1', 'm1'));

    await waitFor(() => {
      const data = queryClient.getQueryData(['conversations']);
      expect(data.conversations.find((c) => c._id === 'c1').unreadCount).toBe(0);
    });
  });

  it('does not mark read while the tab is not visible', async () => {
    setVisibility('hidden');
    const incoming = {
      _id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      text: 'hi there',
      status: 'sent',
      createdAt: '2026-01-10T00:00:00Z',
    };
    getMessages.mockResolvedValue({ messages: [incoming], nextCursor: null, nextAfter: null });

    renderHarness('c1');
    await screen.findByText('hi there');

    expect(emitMessageRead).not.toHaveBeenCalled();
  });

  it('emits message:delivered and increments unreadCount for a live message while backgrounded', async () => {
    getMessages.mockResolvedValue(emptyHistory());
    setVisibility('hidden');

    const { queryClient } = renderHarness('c1', [conversation({ unreadCount: 0 })]);
    await screen.findByText('Grace Hopper');

    const incoming = {
      _id: 'm2',
      conversationId: 'c1',
      senderId: 'u2',
      text: 'while you were away',
      status: 'sent',
      createdAt: '2026-01-10T00:01:00Z',
    };

    await act(async () => {
      handlerFor('message:new')({ message: incoming });
    });

    expect(emitMessageDelivered).toHaveBeenCalledWith('c1', 'm2');
    const data = queryClient.getQueryData(['conversations']);
    expect(data.conversations.find((c) => c._id === 'c1').unreadCount).toBe(1);
  });

  it('does not emit message:delivered for the current user’s own message', async () => {
    getMessages.mockResolvedValue(emptyHistory());
    renderHarness('c1');
    await screen.findByText('Grace Hopper');

    await act(async () => {
      handlerFor('message:new')({
        message: {
          _id: 'm3',
          conversationId: 'c1',
          senderId: 'me',
          text: 'sent from another tab',
          status: 'sent',
          createdAt: '2026-01-10T00:02:00Z',
        },
      });
    });

    expect(emitMessageDelivered).not.toHaveBeenCalled();
  });

  it('updates a sent message’s tick from message:status, monotonically', async () => {
    const own = {
      _id: 'm4',
      conversationId: 'c1',
      senderId: 'me',
      text: 'read me',
      status: 'sent',
      createdAt: '2026-01-10T00:03:00Z',
    };
    getMessages.mockResolvedValue({ messages: [own], nextCursor: null, nextAfter: null });

    renderHarness('c1');
    expect(await screen.findByRole('img', { name: 'Sent' })).toBeInTheDocument();

    await act(async () => {
      handlerFor('message:status')({ conversationId: 'c1', messageId: 'm4', status: 'delivered' });
    });
    expect(await screen.findByRole('img', { name: 'Delivered' })).toBeInTheDocument();

    await act(async () => {
      handlerFor('message:status')({ conversationId: 'c1', upToMessageId: 'm4', status: 'read' });
    });
    expect(await screen.findByRole('img', { name: 'Read' })).toBeInTheDocument();
  });
});

describe('Switching conversations — no state leakage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinConversation.mockResolvedValue({ ok: true });
    getMessages.mockResolvedValue(emptyHistory());
    usePresenceStore.setState({ onlineUserIds: new Set(), lastSeenByUserId: {} });
    useTypingStore.setState({ typingByConversationId: {} });
    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connected', activeConversationId: null });
    setVisibility('visible');
  });

  it('clears a conversation’s typing state once its room is left', async () => {
    renderHarness('c1');
    await screen.findByText('Grace Hopper');

    await act(async () => {
      handlerFor('typing:update')({ conversationId: 'c1', userId: 'u2', isTyping: true });
    });
    expect(useTypingStore.getState().typingByConversationId.c1.has('u2')).toBe(true);

    // Unmounting ActiveConversation (leaving the conversation route) runs
    // useConversationRoom's cleanup exactly like switching to another
    // conversation would. Wrapped in act() so the effect cleanup's
    // (synchronous) state updates are flushed before asserting.
    await act(async () => {
      cleanup();
    });

    expect(useTypingStore.getState().typingByConversationId.c1).toBeUndefined();
  });
});
