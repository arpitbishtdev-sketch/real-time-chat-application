import { useState } from 'react';

import { cx } from '../ui/cx.js';
import { useTypingEmitter } from '../../hooks/useTypingEmitter.js';

const MAX_LENGTH = 4000; // mirrors backend/src/validation/socket.schema.js's message:send text limit

function SendIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3 10 14-6.5L12.5 17l-2.4-6.1L3 10Z"
      />
    </svg>
  );
}

// PROJECT_SPEC.md M14 composer requirements — Enter sends, Shift+Enter
// inserts a newline (the standard chat-app convention); the field clears
// immediately on submit rather than waiting for any server confirmation
// (the message itself renders via the optimistic entry, FRONTEND.md §10);
// disabled while the socket isn't connected, with a reason a screen reader
// can announce, rather than silently swallowing a send no one told the
// user wouldn't go anywhere.
export function MessageInput({ conversationId, onSend, disabled, disabledReason }) {
  const [text, setText] = useState('');
  const { notifyTyping, notifyStopped } = useTypingEmitter(conversationId);

  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;

  function submit() {
    if (!canSend) return;
    onSend(text);
    setText('');
    // FRONTEND.md §16 — stop is also client-initiated on submit, not left
    // to expire only via the server-side TTL.
    notifyStopped();
  }

  function handleChange(event) {
    setText(event.target.value);
    if (event.target.value.trim().length > 0) {
      notifyTyping();
    } else {
      // An emptied draft (e.g. select-all + delete) is "not typing" right
      // away, same as blur/submit — no reason to wait out the idle timer.
      notifyStopped();
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex shrink-0 items-end gap-2 border-t border-line px-4 py-3">
      <label htmlFor="message-input" className="sr-only">
        Message
      </label>
      <textarea
        id="message-input"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={notifyStopped}
        disabled={disabled}
        maxLength={MAX_LENGTH}
        rows={1}
        placeholder={disabled ? disabledReason : 'Write a message…'}
        aria-describedby={disabled && disabledReason ? 'message-input-status' : undefined}
        className={cx(
          'max-h-32 min-h-10 flex-1 resize-none rounded-md border border-line bg-surface-raised px-3 py-2 text-base text-ink',
          'placeholder:text-ink-faint transition-colors duration-150 focus:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      />
      {disabled && disabledReason && (
        <span id="message-input-status" className="sr-only">
          {disabledReason}
        </span>
      )}
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
          'bg-accent text-ink-inverted hover:bg-accent-strong',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent'
        )}
      >
        <SendIcon className="h-4 w-4" />
      </button>
    </form>
  );
}
