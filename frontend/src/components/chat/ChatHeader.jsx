import { Link } from 'react-router-dom';

import { Avatar } from '../ui/Avatar.jsx';
import { Skeleton } from '../ui/Skeleton.jsx';
import { PresenceDot } from '../presence/PresenceDot.jsx';
import { LastSeenLabel } from '../presence/LastSeenLabel.jsx';
import { TypingIndicator } from './TypingIndicator.jsx';

function BackIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 15.5 7 10l5.5-5.5"
      />
    </svg>
  );
}

// FRONTEND.md §18 — the back control only exists below the sm breakpoint,
// where ChatPage renders this pane alone instead of side-by-side with the
// conversation list. `participant` is resolved from the cached
// conversation list (there's no single-conversation REST lookup) — a
// conversation reached by a direct link that isn't in that cache yet
// falls back to a generic label rather than hanging on a permanent
// skeleton (see MessageList's `loading` case for the distinct "still
// fetching" state).
// PROJECT_SPEC.md M15 tasks 1/2 — the subtitle line shows typing state when
// present, otherwise online/last-seen (FRONTEND.md §15/§16); typing takes
// priority since it's the more immediately actionable/attention-worthy
// signal of the two. `aria-live="polite"` since this line changes without
// any user-initiated action on this screen.
export function ChatHeader({ participant, loading, online, lastSeenAt, isTyping }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
      <Link
        to="/"
        aria-label="Back to conversations"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink sm:hidden"
      >
        <BackIcon className="h-4 w-4" />
      </Link>
      {loading ? (
        <>
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </>
      ) : (
        <>
          <div className="relative shrink-0">
            <Avatar name={participant?.displayName} src={participant?.avatarUrl} size="sm" />
            {participant && <PresenceDot online={online} className="absolute -right-0.5 -bottom-0.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium text-ink">
              {participant?.displayName ?? 'Conversation'}
            </p>
            {participant && (
              <p className="truncate text-xs text-ink-faint" aria-live="polite">
                {isTyping ? (
                  <TypingIndicator name={participant.displayName} />
                ) : online ? (
                  'Online'
                ) : (
                  <LastSeenLabel lastSeenAt={lastSeenAt} />
                )}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
