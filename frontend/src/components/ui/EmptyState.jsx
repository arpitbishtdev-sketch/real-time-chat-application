import { cx } from './cx.js';

// Base component set (M11 task 4). Deliberately restrained — no decorative
// illustration that doesn't earn its space (FRONTEND.md §20).
export function EmptyState({ title, description, action, className }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className
      )}
    >
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
