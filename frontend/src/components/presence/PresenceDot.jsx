import { cx } from '../ui/cx.js';

// FRONTEND.md §15/§19 — "green/gray dot," always rendered (never hidden
// when offline) so the state is consistently visible in the same spot, and
// carries a text alternative via aria-label since color is never the sole
// indicator of state.
export function PresenceDot({ online, className }) {
  return (
    <span
      role="img"
      aria-label={online ? 'Online' : 'Offline'}
      className={cx(
        'block h-2.5 w-2.5 rounded-full ring-2 ring-surface',
        online ? 'bg-success' : 'bg-ink-faint/50',
        className
      )}
    />
  );
}
