// FRONTEND.md §16 — "X is typing…" with the same de-emphasized metadata
// treatment as timestamps; rendered in ChatHeader's subtitle line, which
// already carries that treatment for the online/last-seen copy it
// replaces while typing is in progress.
export function TypingIndicator({ name }) {
  return <span>{name ? `${name} is typing…` : 'Typing…'}</span>;
}
