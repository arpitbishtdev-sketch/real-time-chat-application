// FRONTEND.md §8 — pure helpers over the useMessages() infinite-query cache
// shape ({ pages: [{messages, nextCursor, nextAfter}, ...] }, pages[0] is
// the newest batch). Kept free of TanStack Query so the merge/reconcile
// logic is unit-testable without a QueryClient, and so both the socket
// layer (live message:new, reconnection resync) and the composer
// (optimistic send/reconcile/fail) share one dedupe-by-_id rule instead of
// each reimplementing it slightly differently.

function messageExists(pages, id) {
  return pages.some((p) => p.messages.some((m) => m._id === id));
}

// Prepends a persisted message (live via message:new, or a missed-message
// resync batch applied one at a time) to the newest page. A no-op if a
// message with that _id is already present — the same dedupe that
// protects against the ack/broadcast race (REALTIME.md §12a) and a
// reconnection resync overlapping a live event (REALTIME.md §20).
export function insertLiveMessage(data, message) {
  if (!data) return data;
  if (messageExists(data.pages, message._id)) return data;

  const [firstPage, ...rest] = data.pages;
  return {
    ...data,
    pages: [{ ...firstPage, messages: [message, ...firstPage.messages] }, ...rest],
  };
}

// Replaces the optimistic entry (keyed by clientMessageId, FRONTEND.md
// §10) with the server-persisted message once the message:send ack
// arrives, preserving clientMessageId for any later dedupe/lookup.
export function reconcileOptimisticMessage(data, clientMessageId, persistedMessage) {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) =>
        m.clientMessageId === clientMessageId ? { ...persistedMessage, clientMessageId } : m
      ),
    })),
  };
}

// Flips a pending optimistic entry's status in place — used both for
// `failed` (ack error, or no ack within the send timeout, so the bubble
// can render a retry affordance per FRONTEND.md §10/§12 instead of
// silently dropping the send) and for `sending` again on manual retry.
export function setOptimisticMessageStatus(data, clientMessageId, status) {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status } : m)),
    })),
  };
}

export function markOptimisticMessageFailed(data, clientMessageId) {
  return setOptimisticMessageStatus(data, clientMessageId, 'failed');
}

// Surgically updates one conversation's list entry (FRONTEND.md §7)
// instead of refetching ['conversations']. `unreadCount` is deliberately
// left untouched here — live unread updates are M15 scope (M14 only keeps
// the preview text/timestamp current for the conversation the socket has
// open).
export function patchConversationPreview(data, conversationId, { lastMessageAt, lastMessagePreview }) {
  if (!data) return data;

  return {
    ...data,
    conversations: data.conversations.map((c) =>
      c._id === conversationId ? { ...c, lastMessageAt, lastMessagePreview } : c
    ),
  };
}
