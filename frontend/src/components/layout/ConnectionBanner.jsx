import { useSocketStore } from '../../store/socketStore.js';
import { cx } from '../ui/cx.js';
import { Spinner } from '../ui/Spinner.jsx';

const COPY = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected — trying to reconnect will require a page refresh.',
};

// FRONTEND.md §13 — persistent, unobtrusive connection-status indicator.
// `connected` renders nothing (hidden/neutral per the spec); every other
// state is a small dismissable-feeling banner, never a full-page takeover.
export function ConnectionBanner() {
  const status = useSocketStore((state) => state.status);

  if (status === 'connected') return null;

  return (
    <div
      role="status"
      className={cx(
        'flex h-8 shrink-0 items-center justify-center gap-2 border-b border-line text-xs font-medium',
        status === 'disconnected' ? 'bg-danger/10 text-danger' : 'bg-surface-sunken text-ink-muted'
      )}
    >
      {status !== 'disconnected' && <Spinner className="h-3.5 w-3.5" />}
      {COPY[status] ?? COPY.connecting}
    </div>
  );
}
