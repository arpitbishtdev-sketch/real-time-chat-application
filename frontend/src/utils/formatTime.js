// Conversation-list preview timestamp (FRONTEND.md §7/§20) — duration-
// bucketed rather than calendar-day-based so it never depends on the
// viewer's timezone relative to the server's UTC `lastMessageAt`.
export function formatRelativeTime(timestamp, now = new Date()) {
  if (!timestamp) return '';

  const diffMs = now - new Date(timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Message-bubble timestamp (FRONTEND.md §20) — de-emphasized metadata, so
// just the local clock time, no date.
export function formatMessageTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// LastSeenLabel (FRONTEND.md §15) — same duration-bucketing rationale as
// formatRelativeTime (timezone-independent), phrased as presence copy
// rather than a bare duration. `null`/`undefined` means "no known last-seen
// timestamp yet" (presenceStore.js's ambiguous-REST-snapshot case), not
// "definitely offline forever," so it gets its own neutral copy.
export function formatLastSeen(timestamp, now = new Date()) {
  if (!timestamp) return 'Offline';

  const diffMs = now - new Date(timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `Last seen ${days}d ago`;

  return `Last seen ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
