import { cx } from './cx.js';

function initialsFrom(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
}

const SIZE_CLASSES = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-md',
};

// Base component set (M11 task 4). Falls back to initials-on-accent-subtle
// when there's no avatarUrl — this is the common case for MVP users, so it
// isn't a rare edge case treated as an afterthought.
//
// M16 accessibility fix: `decorative` marks the avatar as carrying no
// information of its own — pass it wherever the avatar sits inside a
// single interactive control (a link/button) that already renders the same
// display name as visible text right next to it (ConversationListItem's
// NavLink, NewConversationPanel's result button). Without it, that
// control's computed accessible name doubles the name up (e.g. "Grace
// Hopper's avatar, Grace Hopper, ...") since both the image's alt text and
// the sibling text node feed into the same accessible-name computation.
export function Avatar({ name, src, size = 'md', className, decorative = false }) {
  const sizeClass = SIZE_CLASSES[size];

  if (src) {
    return (
      <img
        src={src}
        alt={decorative ? '' : name ? `${name}’s avatar` : ''}
        className={cx('rounded-full object-cover', sizeClass, className)}
      />
    );
  }

  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : name ? `${name}’s avatar` : 'Avatar'}
      className={cx(
        'inline-flex items-center justify-center rounded-full bg-accent-subtle font-medium text-accent-strong',
        sizeClass,
        className
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}
