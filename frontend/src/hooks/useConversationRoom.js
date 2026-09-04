import { useEffect, useState } from 'react';

import { useSocketStore } from '../store/socketStore.js';
import { joinConversation, leaveConversation } from '../sockets/socketClient.js';

// PROJECT_SPEC.md M14 task 2 — join the conversation's room while it's the
// one open in this tab, leave it when navigating away or switching to a
// different conversation (ChatPage reuses the same ActiveConversation
// instance across conversationId changes, so this has to react to prop
// changes, not just mount/unmount). Records the open conversation in
// socketStore so useSocketConnection can re-join/resync it after a
// reconnect (REALTIME.md §18) without ActiveConversation needing to know
// anything about reconnection.
export function useConversationRoom(conversationId) {
  const status = useSocketStore((state) => state.status);
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    if (!conversationId || status !== 'connected') return undefined;

    let cancelled = false;
    useSocketStore.getState().setActiveConversationId(conversationId);

    joinConversation(conversationId).then((response) => {
      if (cancelled) return;
      setJoinError(
        response.ok
          ? null
          : (response.error ?? { code: 'INTERNAL_ERROR', message: 'Could not open this conversation.' })
      );
    });

    return () => {
      cancelled = true;
      leaveConversation(conversationId);
      useSocketStore.getState().clearActiveConversationId(conversationId);
    };
  }, [conversationId, status]);

  return { joinError };
}
