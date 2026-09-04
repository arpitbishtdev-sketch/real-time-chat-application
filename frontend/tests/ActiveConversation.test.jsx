import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
  // M15 additions (MessageInput now drives useTypingEmitter) — mocked here
  // purely so this M14 suite's existing scenarios keep working unchanged;
  // typing behavior itself is covered in RealtimePresenceTyping.test.jsx.
  emitTypingStart: vi.fn(),
  emitTypingStop: vi.fn(),
  emitMessageDelivered: vi.fn(),
  emitMessageRead: vi.fn(),
}));

import { ActiveConversation } from '../src/components/chat/ActiveConversation.jsx';
import { useSocketConnection } from '../src/hooks/useSocketConnection.js';
import { getConversations, getMessages } from '../src/api/conversations.api.js';
import { socket, sendMessage, joinConversation, leaveConversation } from '../src/sockets/socketClient.js';
import { useAuthStore } from '../src/store/authStore.js';
import { useSocketStore } from '../src/store/socketStore.js';
import { renderWithProviders } from './testUtils.jsx';

afterEach(cleanup);

// PROJECT_SPEC.md M14 — real-time messaging UI, layered onto M13's static
// conversation view. Most tests only need ActiveConversation's own hooks
// (useConversationRoom, useMessageSend), which read socketStore directly —
// mounting useSocketConnection too would immediately flip its seeded
// 'connected' status to 'connecting' (the hook sets that the instant it
// runs, same as it would for a real still-handshaking socket) with no
// mocked 'connect' event ever firing to bring it back. Only the
// message:new listener test needs useSocketConnection mounted, since
// that's the one thing it (not ActiveConversation) owns — see
// ConnectedHarness below.
function Harness({ conversationId }) {
  return <ActiveConversation conversationId={conversationId} />;
}

function ConnectedHarness({ conversationId }) {
  useSocketConnection();
  return <ActiveConversation conversationId={conversationId} />;
}

const CONVERSATION = {
  _id: 'c1',
  otherParticipant: { _id: 'u2', displayName: 'Grace Hopper', avatarUrl: null },
  lastMessageAt: null,
  lastMessagePreview: null,
  unreadCount: 0,
};

function emptyHistory() {
  return { messages: [], nextCursor: null, nextAfter: null };
}

// RTL's rerender() only reapplies a wrapper supplied via the `wrapper`
// option (renderWithProviders nests JSX manually instead, so its rerender
// would drop the providers) — needed here to prop-change conversationId on
// the same ActiveConversation instance, exactly like ChatPage does (no
// `key`, so switching conversations never remounts it).
function renderHarness(conversationId) {
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
  return { ...render(<Harness conversationId={conversationId} />, { wrapper: Wrapper }), queryClient };
}

function messageNewHandler() {
  const call = socket.on.mock.calls.find(([event]) => event === 'message:new');
  return call?.[1];
}

describe('ActiveConversation — real-time messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversations.mockResolvedValue({ conversations: [CONVERSATION], nextCursor: null });
    getMessages.mockResolvedValue(emptyHistory());
    joinConversation.mockResolvedValue({ ok: true });

    useAuthStore.setState({ user: { _id: 'me', displayName: 'Me' }, status: 'authenticated' });
    useSocketStore.setState({ status: 'connected', activeConversationId: null });
  });

  it('joins the conversation room on mount and leaves it when the conversation changes', async () => {
    const { rerender } = renderHarness('c1');

    await waitFor(() => expect(joinConversation).toHaveBeenCalledWith('c1'));

    getMessages.mockResolvedValue(emptyHistory());
    rerender(<Harness conversationId="c2" />);

    await waitFor(() => expect(leaveConversation).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(joinConversation).toHaveBeenCalledWith('c2'));
  });

  it('sends a message optimistically, then reconciles it with the ack', async () => {
    let resolveAck;
    sendMessage.mockReturnValue(new Promise((resolve) => (resolveAck = resolve)));

    renderWithProviders(<Harness conversationId="c1" />);

    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'hello there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Renders immediately, before the ack resolves (FRONTEND.md §10).
    expect(await screen.findByText('hello there')).toBeInTheDocument();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(input).toHaveValue('');

    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: 'c1',
      clientMessageId: expect.any(String),
      text: 'hello there',
    });
    const clientMessageId = sendMessage.mock.calls[0][0].clientMessageId;

    await act(async () => {
      resolveAck({
        ok: true,
        message: {
          _id: 'm1',
          conversationId: 'c1',
          senderId: 'me',
          text: 'hello there',
          status: 'sent',
          createdAt: '2026-01-10T00:03:00Z',
        },
      });
    });

    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeInTheDocument());
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(clientMessageId).toBeTruthy();
  });

  it('shows a retry affordance on send failure, and resends the same clientMessageId', async () => {
    sendMessage.mockRejectedValueOnce(new Error('ack timeout'));

    renderWithProviders(<Harness conversationId="c1" />);

    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'will fail' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText("Couldn't send.")).toBeInTheDocument();
    const firstClientMessageId = sendMessage.mock.calls[0][0].clientMessageId;

    sendMessage.mockResolvedValueOnce({
      ok: true,
      message: {
        _id: 'm2',
        conversationId: 'c1',
        senderId: 'me',
        text: 'will fail',
        status: 'sent',
        createdAt: '2026-01-10T00:04:00Z',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByText("Couldn't send.")).not.toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].clientMessageId).toBe(firstClientMessageId);
  });

  it('renders an incoming message:new event live, without duplicating an already-known message', async () => {
    renderWithProviders(<ConnectedHarness conversationId="c1" />);

    await screen.findByText('No messages yet');
    const handler = messageNewHandler();
    expect(handler).toBeTypeOf('function');

    const incoming = {
      _id: 'm3',
      conversationId: 'c1',
      senderId: 'u2',
      text: 'hey there',
      status: 'sent',
      createdAt: '2026-01-10T00:05:00Z',
    };

    await act(async () => {
      handler({ message: incoming });
    });

    expect(await screen.findByText('hey there')).toBeInTheDocument();

    // A second delivery of the same message (e.g. ack + broadcast, or a
    // reconnection resync racing a live event, REALTIME.md §12a/§20) must
    // never render a duplicate bubble.
    await act(async () => {
      handler({ message: incoming });
    });

    expect(screen.getAllByText('hey there')).toHaveLength(1);
  });

  it('disables the composer while the socket is not connected', async () => {
    useSocketStore.setState({ status: 'reconnecting' });

    renderWithProviders(<Harness conversationId="c1" />);

    const input = await screen.findByLabelText('Message');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
