import { NavLink } from 'react-router-dom';

import { cx } from '../ui/cx.js';
import { Avatar } from '../ui/Avatar.jsx';
import { PresenceDot } from '../presence/PresenceDot.jsx';
import { usePresence } from '../../store/presenceStore.js';
import { formatRelativeTime } from '../../utils/formatTime.js';

export function ConversationListItem({ conversation }) {
  const { _id, otherParticipant, lastMessageAt, lastMessagePreview, unreadCount } = conversation;
  // FRONTEND.md §15 — dot only here (full "last seen" text lives in the
  // chat header, where there's room for it without crowding the list row).
  const { online } = usePresence(otherParticipant?._id);

  return (
    <NavLink
      to={`/conversations/${_id}`}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-3 px-4 py-3 transition-colors duration-150',
          isActive ? 'bg-accent-subtle' : 'hover:bg-surface-sunken'
        )
      }
    >
      <div className="relative shrink-0">
        <Avatar
          name={otherParticipant?.displayName}
          src={otherParticipant?.avatarUrl}
          size="md"
          decorative
        />
        <PresenceDot online={online} className="absolute -right-0.5 -bottom-0.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-ink">
            {otherParticipant?.displayName ?? 'Unknown user'}
          </p>
          <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-ink-muted">{lastMessagePreview ?? 'No messages yet'}</p>
          {unreadCount > 0 && (
            <span
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-ink-inverted"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </NavLink>
  );
}
