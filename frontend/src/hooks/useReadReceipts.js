import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../store/authStore.js';
import { useSocketStore } from '../store/socketStore.js';
import { useMessages } from '../queries/useMessages.js';
import { emitMessageRead } from '../sockets/socketClient.js';
import { clearUnreadCount } from '../utils/messageCache.js';
import { useDocumentVisibility } from './useDocumentVisibility.js';

// PROJECT_SPEC.md M15 task 4, FRONTEND.md §14 — marks messages read only
// while this conversation is both the active route and the tab is visible
// (Page Visibility API, not window focus/blur), batched as "read up to the
// newest message currently loaded" rather than one message:read call per
// message (REALTIME.md §17). Re-evaluates whenever new messages arrive,
// the tab regains visibility, or the connection comes back — a message
// that arrived while backgrounded/disconnected gets caught on the next
// qualifying transition, not just at mount.
export function useReadReceipts(conversationId, joinError) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?._id);
  const connectionStatus = useSocketStore((state) => state.status);
  const isVisible = useDocumentVisibility();
  const { data } = useMessages(conversationId);

  // Dedupes so a re-render with the same "latest from the other
  // participant" doesn't re-emit — reset per conversation so switching
  // away and back never carries a stale watermark across conversations
  // (PROJECT_SPEC.md M15 "no cross-conversation leakage").
  const lastAckedIdRef = useRef(null);
  useEffect(() => {
    lastAckedIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || joinError) return;
    if (connectionStatus !== 'connected' || !isVisible) return;
    if (!data) return;

    // pages[0] is newest-first (messageCache.js), so the first message not
    // sent by the current user, walking newest to oldest, is already the
    // correct "latest visible" watermark — no separate unread-status filter
    // needed, since a repeat of an already-read id is a safe server no-op
    // (REALTIME.md §11) and is deduped locally anyway via lastAckedIdRef.
    const latestFromOther = data.pages
      .flatMap((page) => page.messages)
      .find((message) => message.senderId !== currentUserId);

    if (!latestFromOther || latestFromOther._id === lastAckedIdRef.current) return;

    lastAckedIdRef.current = latestFromOther._id;
    emitMessageRead(conversationId, latestFromOther._id).then((response) => {
      if (!response.ok) {
        // Allow a retry on the next qualifying transition rather than
        // permanently giving up on this watermark.
        lastAckedIdRef.current = null;
        return;
      }
      queryClient.setQueryData(['conversations'], (prev) => clearUnreadCount(prev, conversationId));
    });
  }, [conversationId, joinError, connectionStatus, isVisible, data, queryClient, currentUserId]);
}
