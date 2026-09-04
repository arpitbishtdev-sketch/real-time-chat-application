import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../store/authStore.js';
import { useSocketStore } from '../store/socketStore.js';
import { socket, connectSocket, disconnectSocket } from '../sockets/socketClient.js';
import { getMessages } from '../api/conversations.api.js';
import { insertLiveMessage, patchConversationPreview } from '../utils/messageCache.js';

// A single reconnect shouldn't be able to loop forever even if the
// backend's nextAfter contract were ever violated — defensive cap only.
const MAX_RESYNC_PAGES = 20;

// REALTIME.md §19 — "what did I miss" sync, keyed off the newest message
// this client already has cached for the currently-open conversation. A
// no-op if that conversation has no cached history yet (nothing to anchor
// `after` on) — the normal REST history load already covers that case.
async function resyncActiveConversation(queryClient, conversationId) {
  if (!conversationId) return;

  const cached = queryClient.getQueryData(['messages', conversationId]);
  const newest = cached?.pages?.[0]?.messages?.[0];
  if (!newest) return;

  let after = newest._id;
  let lastMessage = null;

  for (let i = 0; i < MAX_RESYNC_PAGES; i += 1) {
    // Sequential by necessity: each page's `after` is the previous page's
    // `nextAfter`, not knowable until that fetch resolves.
    const page = await getMessages(conversationId, { after });

    // BACKEND.md §12 — oldest-of-the-missed-batch first; inserting each in
    // that order (repeated front-of-newest-page prepend) reproduces the
    // correct newest-first cache order.
    for (const message of page.messages) {
      queryClient.setQueryData(['messages', conversationId], (data) => insertLiveMessage(data, message));
      lastMessage = message;
    }

    if (!page.nextAfter) break;
    after = page.nextAfter;
  }

  if (lastMessage) {
    queryClient.setQueryData(['conversations'], (data) =>
      patchConversationPreview(data, conversationId, {
        lastMessageAt: lastMessage.createdAt,
        lastMessagePreview: lastMessage.text,
      })
    );
  }
}

// FRONTEND.md §9 — mounted once near the app root (AppShell). Owns the
// authenticated-session-driven connect/disconnect lifecycle, the
// connection-status UI state (§13), the per-connect resync (§9/§19), and
// the one global `message:new` listener (a socket only ever receives this
// for a conversation it has joined, so a single app-wide listener is
// simpler and cheaper than registering/tearing one down per open chat).
export function useSocketConnection() {
  const authStatus = useAuthStore((state) => state.status);
  const setStatus = useSocketStore((state) => state.setStatus);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      disconnectSocket();
      return undefined;
    }

    useSocketStore.getState().setStatus('connecting');
    connectSocket();

    function handleConnect() {
      setStatus('connected');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });

      // REALTIME.md §19 — resync whatever conversation is currently open.
      // Re-joining that conversation's room is useConversationRoom's job
      // (its effect depends on connection status, so it re-runs and
      // re-emits conversation:join on this same 'connected' transition) —
      // not duplicated here. A no-op on the very first connect, before any
      // conversation has been opened yet.
      const activeConversationId = useSocketStore.getState().activeConversationId;
      if (activeConversationId) {
        resyncActiveConversation(queryClient, activeConversationId).catch((err) => {
          console.error('Reconnection resync failed:', err);
        });
      }
    }

    function handleDisconnect(reason) {
      // 'io server disconnect' / 'io client disconnect' are not retried
      // automatically by Socket.IO; every other reason is (exponential
      // backoff, on by default — FRONTEND.md §13/REALTIME.md §18).
      const willAutoReconnect = reason !== 'io server disconnect' && reason !== 'io client disconnect';
      setStatus(willAutoReconnect ? 'reconnecting' : 'disconnected');
    }

    function handleConnectError() {
      // Socket.IO's manager keeps retrying a failed handshake with the same
      // backoff as a mid-session drop (REALTIME.md §18) — including the
      // case where the access-token cookie was stale and a since-completed
      // REST refresh (api/client.js's own 401 handling) makes the next
      // attempt succeed with no special handling needed here.
      setStatus('reconnecting');
    }

    function handleMessageNew({ message }) {
      queryClient.setQueryData(['messages', message.conversationId], (data) =>
        insertLiveMessage(data, message)
      );
      queryClient.setQueryData(['conversations'], (data) =>
        patchConversationPreview(data, message.conversationId, {
          lastMessageAt: message.createdAt,
          lastMessagePreview: message.text,
        })
      );
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('message:new', handleMessageNew);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('message:new', handleMessageNew);
      disconnectSocket();
    };
  }, [authStatus, queryClient, setStatus]);
}
