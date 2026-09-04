import { NavLink } from 'react-router-dom';

import { cx } from '../ui/cx.js';
import { Avatar } from '../ui/Avatar.jsx';
import { formatRelativeTime } from '../../utils/formatTime.js';

export function ConversationListItem({ conversation }) {
  const { _id, otherParticipant, lastMessageAt, lastMessagePreview, unreadCount } = conversation;

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
      <Avatar name={otherParticipant?.displayName} src={otherParticipant?.avatarUrl} size="md" />
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
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    </NavLink>
  );
}
