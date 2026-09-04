import { cx } from '../ui/cx.js';
import { formatMessageTime } from '../../utils/formatTime.js';

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
      <div className={cx('flex max-w-[75%] flex-col', isOwn ? 'items-end' : 'items-start')}>
        <div
          className={cx(
            'rounded-lg px-3 py-2',
            isOwn ? 'bg-accent text-ink-inverted' : 'border border-line bg-surface-raised text-ink',
            isSending && 'opacity-60',
            isFailed && 'opacity-80 ring-1 ring-danger'
          )}
        >
          <p className="whitespace-pre-wrap break-words text-base">{message.text}</p>
          <p className={cx('mt-1 text-xs', isOwn ? 'text-ink-inverted/70' : 'text-ink-faint')}>
            {isSending ? 'Sending…' : formatMessageTime(message.createdAt)}
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
