import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getConversations } from '../api/conversations.api.js';
import { usePresenceStore } from '../store/presenceStore.js';

// FRONTEND.md §7 — server state via useQuery, keyed ['conversations'].
// M13 fetches only the first page; PROJECT_SPEC.md M13 only requires
// pagination on message history, not the conversation list itself.
export function useConversations() {
  const query = useQuery({
    queryKey: ['conversations'],
    queryFn: () => getConversations(),
  });

  // PROJECT_SPEC.md M15 task 1 — presenceStore.js's REST bootstrap:
  // otherParticipant.lastSeenAt is the only presence signal available
  // before any live presence:online/offline event has been observed this
  // session. Runs here (not in each consumer) so every screen that reads
  // the conversation list feeds the same one presence bootstrap.
  useEffect(() => {
    const conversations = query.data?.conversations;
    if (!conversations) return;
    for (const conversation of conversations) {
      const other = conversation.otherParticipant;
      if (other?._id) {
        usePresenceStore.getState().seedLastSeen(other._id, other.lastSeenAt ?? null);
      }
    }
  }, [query.data]);

  return query;
}
