import { useQuery } from '@tanstack/react-query';

import { getConversations } from '../api/conversations.api.js';

// FRONTEND.md §7 — server state via useQuery, keyed ['conversations'].
// M13 fetches only the first page; PROJECT_SPEC.md M13 only requires
// pagination on message history, not the conversation list itself.
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => getConversations(),
  });
}
