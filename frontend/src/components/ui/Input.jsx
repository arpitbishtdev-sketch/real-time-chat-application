import { useId } from 'react';

import { cx } from './cx.js';

// Base component set (M11 task 4). Label association + aria-describedby
// for hints/errors is built in here, not left for every call site to
// remember (FRONTEND.md §19).
export function Input({ label, error, hint, className, id, ...props }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-muted">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cx(
          'h-10 rounded-md border bg-surface-raised px-3 text-base text-ink placeholder:text-ink-faint transition-colors duration-150',
          error ? 'border-danger' : 'border-line focus:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
