import { cx } from './cx.js';
import { Spinner } from './Spinner.jsx';

const VARIANT_CLASSES = {
  primary: 'bg-accent text-ink-inverted hover:bg-accent-strong disabled:hover:bg-accent',
  secondary:
    'border border-line bg-surface-raised text-ink hover:border-line-strong disabled:hover:border-line',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-danger text-ink-inverted hover:opacity-90 disabled:hover:opacity-100',
};

const SIZE_CLASSES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
};

// Base component set (PROJECT_SPEC.md M11 task 4). `type="button"` by
// default so it never accidentally submits a form it happens to live
// inside — pass type="submit" explicitly where that's the intent.
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 ease-out-standard disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
