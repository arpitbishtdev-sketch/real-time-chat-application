import { useInfiniteQuery } from '@tanstack/react-query';

import { getMessages } from '../api/conversations.api.js';

// FRONTEND.md §8 — useInfiniteQuery keyed ['messages', conversationId],
// pages fetched with BACKEND.md §12's cursor contract ("load older").
export function useMessages(conversationId) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => getMessages(conversationId, { cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
  });
}
