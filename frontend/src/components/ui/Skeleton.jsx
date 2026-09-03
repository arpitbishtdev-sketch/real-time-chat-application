import { cx } from './cx.js';

// Base component set (M11 task 4). Loading primitive used in place of a
// blocking full-page spinner (FRONTEND.md §11).
export function Skeleton({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-md bg-surface-sunken', className)}
    />
  );
}
