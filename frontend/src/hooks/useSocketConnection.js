import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../store/authStore.js';
import { useSocketStore } from '../store/socketStore.js';
import { usePresenceStore } from '../store/presenceStore.js';
import { useTypingStore } from '../store/typingStore.js';
import { socket, connectSocket, disconnectSocket, emitMessageDelivered } from '../sockets/socketClient.js';
import { getMessages } from '../api/conversations.api.js';
import {
  insertLiveMessage,
  patchConversationPreview,
  incrementUnreadCount,
  applyMessageDeliveredStatus,
  applyMessageReadStatus,
} from '../utils/messageCache.js';

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

    // PROJECT_SPEC.md M15 task 3/6 — a live message:new only ever reaches
    // this socket for a conversation it has joined (REALTIME.md §7), which
    // today is at most the one currently-active conversation; that's also
    // exactly the scope useReadReceipts marks read, so "would this message
    // be immediately read" and "is this the currently open+visible
    // conversation" are the same condition here.
    function handleMessageNew({ message }) {
      const currentUserId = useAuthStore.getState().user?._id;
      const isOwnMessage = message.senderId === currentUserId;
      const isActiveAndVisible =
        message.conversationId === useSocketStore.getState().activeConversationId &&
        document.visibilityState === 'visible';

      queryClient.setQueryData(['messages', message.conversationId], (data) =>
        insertLiveMessage(data, message)
      );
      queryClient.setQueryData(['conversations'], (data) => {
        const withPreview = patchConversationPreview(data, message.conversationId, {
          lastMessageAt: message.createdAt,
          lastMessagePreview: message.text,
        });
        return isOwnMessage || isActiveAndVisible
          ? withPreview
          : incrementUnreadCount(withPreview, message.conversationId);
      });

      // PROJECT_SPEC.md M15 task 3 — closes the loop from M8's backend
      // logic: the client confirms receipt of a message it didn't send.
      if (!isOwnMessage) {
        emitMessageDelivered(message.conversationId, message._id);
      }
    }

    // PROJECT_SPEC.md M15 task 1 — presenceStore is the single source of
    // truth for "is this contact online," read by PresenceDot/LastSeenLabel
    // wherever they're rendered, never re-derived per component.
    function handlePresenceOnline({ userId }) {
      usePresenceStore.getState().setOnline(userId);
    }

    function handlePresenceOffline({ userId, lastSeenAt }) {
      usePresenceStore.getState().setOffline(userId, lastSeenAt);
    }

    // PROJECT_SPEC.md M15 task 2 — typingStore mirrors REALTIME.md §11's
    // typing:update payload directly; per-conversation scoping is the
    // store's job (typingStore.js), not this handler's.
    function handleTypingUpdate({ conversationId, userId, isTyping }) {
      useTypingStore.getState().setTyping(conversationId, userId, isTyping);
    }

    // PROJECT_SPEC.md M15 task 5 — message:status has two payload shapes
    // (REALTIME.md §17b): a single messageId from message:delivered, or an
    // upToMessageId watermark from a bulk message:read. Reaches every one
    // of the sender's own sockets via the user:<id> room regardless of
    // which conversation (if any) is currently open there.
    function handleMessageStatus(payload) {
      const currentUserId = useAuthStore.getState().user?._id;
      if (payload.status === 'delivered') {
        queryClient.setQueryData(['messages', payload.conversationId], (data) =>
          applyMessageDeliveredStatus(data, payload.messageId)
        );
      } else if (payload.status === 'read') {
        queryClient.setQueryData(['messages', payload.conversationId], (data) =>
          applyMessageReadStatus(data, payload.upToMessageId, currentUserId)
        );
      }
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('message:new', handleMessageNew);
    socket.on('presence:online', handlePresenceOnline);
    socket.on('presence:offline', handlePresenceOffline);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('message:status', handleMessageStatus);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('message:new', handleMessageNew);
      socket.off('presence:online', handlePresenceOnline);
      socket.off('presence:offline', handlePresenceOffline);
      socket.off('typing:update', handleTypingUpdate);
      socket.off('message:status', handleMessageStatus);
      disconnectSocket();
    };
  }, [authStatus, queryClient, setStatus]);
}
