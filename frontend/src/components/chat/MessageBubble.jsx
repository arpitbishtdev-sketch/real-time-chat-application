import { cx } from '../ui/cx.js';
import { formatMessageTime } from '../../utils/formatTime.js';

// FRONTEND.md §20 — the user's own messages carry the one accent color in
// the whole palette; everyone else's are a neutral surface. `groupStart`
// controls spacing only (tight within a consecutive run from the same
// sender, roomier at a new sender/time-gap) — the timestamp itself always
// renders, just visually de-emphasized (size/color, not hidden).
export function MessageBubble({ message, isOwn, groupStart }) {
  return (
    <div className={cx('flex', isOwn ? 'justify-end' : 'justify-start', groupStart ? 'mt-3' : 'mt-0.5')}>
      <div
        className={cx(
          'max-w-[75%] rounded-lg px-3 py-2',
          isOwn ? 'bg-accent text-ink-inverted' : 'border border-line bg-surface-raised text-ink'
        )}
      >
        <p className="whitespace-pre-wrap break-words text-base">{message.text}</p>
        <p className={cx('mt-1 text-xs', isOwn ? 'text-ink-inverted/70' : 'text-ink-faint')}>
          {formatMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
