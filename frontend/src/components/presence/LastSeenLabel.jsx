import { formatLastSeen } from '../../utils/formatTime.js';

// FRONTEND.md §15 — replaces the online/offline copy in the chat header
// when the contact isn't currently online.
export function LastSeenLabel({ lastSeenAt, className }) {
  return <span className={className}>{formatLastSeen(lastSeenAt)}</span>;
}
