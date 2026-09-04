import { cx } from '../ui/cx.js';
import { formatMessageTime } from '../../utils/formatTime.js';

function CheckIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.5l3 3 7-7"
      />
    </svg>
  );
}

function DoubleCheckIcon(props) {
  return (
    <svg viewBox="0 0 20 16" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M1 8.5l3 3 7-7"
      />
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 8.5l3 3 7-7"
      />
    </svg>
  );
}

const STATUS_LABEL = { sent: 'Sent', delivered: 'Delivered', read: 'Read' };

// FRONTEND.md §17/§19 — single check / double check / filled double check,
// with a text alternative (aria-label) so the state isn't carried by
// shape+color alone for anyone using a screen reader.
function MessageStatusIcon({ status }) {
  const label = STATUS_LABEL[status];
  if (!label) return null;

  const Icon = status === 'sent' ? CheckIcon : DoubleCheckIcon;

  return (
    <span
      role="img"
      aria-label={label}
      className={status === 'read' ? 'text-ink-inverted' : 'text-ink-inverted/70'}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

// FRONTEND.md §20 — the user's own messages carry the one accent color in
// the whole palette; everyone else's are a neutral surface. `groupStart`
// controls spacing only (tight within a consecutive run from the same
// sender, roomier at a new sender/time-gap) — the timestamp itself always
// renders, just visually de-emphasized (size/color, not hidden).
//
// PROJECT_SPEC.md M14 task 4/composer requirements — `message.status` of
// `sending`/`failed` only ever appears on the current user's own optimistic
// entries (FRONTEND.md §10); a failed send surfaces inline on the bubble
// itself, not as a toast that can be missed (FRONTEND.md §12), with a
// keyboard-reachable retry control alongside it.
export function MessageBubble({ message, isOwn, groupStart, onRetry }) {
  const isSending = message.status === 'sending';
  const isFailed = message.status === 'failed';

  return (
    <div className={cx('flex', isOwn ? 'justify-end' : 'justify-start', groupStart ? 'mt-3' : 'mt-0.5')}>
      <div
        className={cx(
          // M16 fix: 75% alone left message lines absurdly wide on large
          // desktop viewports (FRONTEND.md §20's "restrained" bar) — cap the
          // bubble at a comfortable reading width too.
          'flex min-w-0 max-w-[min(75%,34rem)] flex-col',
          isOwn ? 'items-end' : 'items-start'
        )}
      >
        <div
          className={cx(
            'rounded-lg px-3 py-2',
            isOwn ? 'bg-accent text-ink-inverted' : 'border border-line bg-surface-raised text-ink',
            isSending && 'opacity-60',
            isFailed && 'opacity-80 ring-1 ring-danger'
          )}
        >
          {/* M16 fix: overflow-wrap:break-word (Tailwind's break-words) doesn't
              shrink a shrink-to-fit box's min-content size, so a single long
              unbroken token still overflowed max-w-[75%] and the viewport.
              overflow-wrap:anywhere (wrap-anywhere) does affect min-content
              sizing, so the bubble correctly shrinks to fit. */}
          <p className="whitespace-pre-wrap wrap-anywhere text-base">{message.text}</p>
          <p className="mt-1 flex items-center gap-1 text-xs">
            <span className={isOwn ? 'text-ink-inverted/70' : 'text-ink-faint'}>
              {isSending ? 'Sending…' : formatMessageTime(message.createdAt)}
            </span>
            {isOwn && !isSending && !isFailed && <MessageStatusIcon status={message.status} />}
          </p>
        </div>
        {isFailed && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-danger">
            Couldn't send.
            <button
              type="button"
              onClick={() => onRetry?.(message)}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
