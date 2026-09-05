import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { MessageBubble } from '../src/components/chat/MessageBubble.jsx';

afterEach(cleanup);

function message(overrides = {}) {
  return {
    _id: 'm1',
    conversationId: 'c1',
    senderId: 'u2',
    status: 'sent',
    createdAt: '2026-01-10T00:00:00Z',
    ...overrides,
  };
}

// CLAUDE.md §6 / TESTING.md §8 — "a rendering test confirms a message
// containing <script>/HTML-like content is displayed as inert text, never
// executed or injected as HTML." MessageBubble interpolates message.text
// via JSX ({message.text}), which React escapes by default, but that
// guarantee had no dedicated regression test anywhere in the suite
// (PROJECT_SPEC.md §18's "XSS-safe message rendering" checklist row was
// still unticked) — this closes that gap explicitly rather than relying on
// it being an incidental side effect of "the text just happens to render."
describe('MessageBubble — XSS-safe rendering (TESTING.md §8)', () => {
  it('renders a <script>-bearing message as inert literal text, never as executed/injected HTML', () => {
    const payload = '<script>window.__xss = true;</script>';
    const { container } = render(<MessageBubble message={message({ text: payload })} isOwn={false} groupStart />);

    // The literal tag text is visible to the user...
    expect(screen.getByText(payload)).toBeInTheDocument();
    // ...but never parsed into an actual <script> element or executed.
    expect(container.querySelector('script')).toBeNull();
    expect(window.__xss).toBeUndefined();
  });

  it('renders an <img onerror=...> payload as literal text, never as a real <img> element', () => {
    const payload = '<img src=x onerror="window.__xss = true">';
    const { container } = render(<MessageBubble message={message({ text: payload })} isOwn />);

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(window.__xss).toBeUndefined();
  });

  it('never uses dangerouslySetInnerHTML to render message text', () => {
    // A static guard against a future regression reintroducing raw HTML
    // rendering — CLAUDE.md §6/§16 forbid it outright, so this asserts the
    // source contract, not just one payload's observable behavior.
    const source = MessageBubble.toString();
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});
