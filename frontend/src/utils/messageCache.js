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
// instead of refetching ['conversations']. `unreadCount` is handled by the
// separate increment/clear helpers below (M15) — kept out of this call so
// the "preview text/timestamp" update and the "did this make it unread"
// decision (which depends on who sent it and whether it's about to be
// auto-read) stay independently composable at the call site.
export function patchConversationPreview(data, conversationId, { lastMessageAt, lastMessagePreview }) {
  if (!data) return data;

  return {
    ...data,
    conversations: data.conversations.map((c) =>
      c._id === conversationId ? { ...c, lastMessageAt, lastMessagePreview } : c
    ),
  };
}

// PROJECT_SPEC.md M15 task 6 — a live message:new for a conversation that
// isn't both the active route and visible (useSocketConnection decides
// that condition) bumps its badge count exactly like the server's own
// `$inc` would for a REST refetch, so the two paths never disagree.
export function incrementUnreadCount(data, conversationId) {
  if (!data) return data;

  return {
    ...data,
    conversations: data.conversations.map((c) =>
      c._id === conversationId ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 } : c
    ),
  };
}

// Mirrors the server's watermark clear (conversation.service.js
// markConversationRead): since useReadReceipts always marks read "up to the
// newest message currently loaded," a successful ack means nothing in this
// conversation is unread anymore from this client's point of view — set to
// 0 directly rather than trying to decrement by an exact count the ack
// doesn't carry (REALTIME.md §11's `message:read` ack is `{ok}` only).
export function clearUnreadCount(data, conversationId) {
  if (!data) return data;

  return {
    ...data,
    conversations: data.conversations.map((c) => (c._id === conversationId ? { ...c, unreadCount: 0 } : c)),
  };
}

// message:status → 'delivered'/'read' are monotonic server-side (REALTIME.md
// §17a); mirrored client-side so an out-of-order re-delivery of an older
// status (e.g. a delayed 'delivered' arriving after 'read' was already
// applied) can never regress a bubble's tick backwards.
const STATUS_RANK = { sent: 0, delivered: 1, read: 2 };

function advanceStatus(current, incoming) {
  return (STATUS_RANK[incoming] ?? -1) > (STATUS_RANK[current] ?? -1) ? incoming : current;
}

// message:status with a single `messageId` (REALTIME.md §10/§17b) —
// originates from message:delivered, always exactly one message.
export function applyMessageDeliveredStatus(data, messageId) {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) =>
        m._id === messageId ? { ...m, status: advanceStatus(m.status, 'delivered') } : m
      ),
    })),
  };
}

// message:status with `upToMessageId` (REALTIME.md §17b) — originates from
// a bulk message:read on the *other* participant's client, so it applies
// to every message *this* user sent (`senderId === currentUserId`) with
// `createdAt <= that message's createdAt`, mirroring
// conversation.service.js's markConversationRead filter exactly. A no-op if
// the cursor message itself isn't in this client's currently loaded pages
// (nothing to anchor the comparison on) — it'll reflect correctly next time
// this conversation's history is fetched.
export function applyMessageReadStatus(data, upToMessageId, currentUserId) {
  if (!data) return data;

  const cursor = data.pages.flatMap((p) => p.messages).find((m) => m._id === upToMessageId);
  if (!cursor) return data;

  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) =>
        m.senderId === currentUserId && m.createdAt <= cursor.createdAt
          ? { ...m, status: advanceStatus(m.status, 'read') }
          : m
      ),
    })),
  };
}
