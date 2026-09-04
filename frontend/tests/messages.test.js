import { describe, it, expect } from 'vitest';

import { flattenMessagePages, isGroupStart } from '../src/utils/messages.js';

// PROJECT_SPEC.md M13 task 4/7 — pagination flattening and grouping are the
// two pieces of real logic behind the message list (TESTING.md §6: effort
// goes where the logic is), so they're pure functions tested directly
// rather than only indirectly through a rendered component.
function msg(id, createdAt, senderId = 'u1') {
  return { _id: id, senderId, createdAt, text: id };
}

describe('flattenMessagePages', () => {
  it('flattens newest-first pages into a single oldest-first list', () => {
    // Page 0 is the most recent batch (each page itself newest-first,
    // matching the backend's { createdAt: -1 } sort); page 1 was fetched
    // afterward via "load older" and holds the older batch.
    const pages = [
      { messages: [msg('4', '2026-01-01T00:03:00Z'), msg('3', '2026-01-01T00:02:00Z')] },
      { messages: [msg('2', '2026-01-01T00:01:00Z'), msg('1', '2026-01-01T00:00:00Z')] },
    ];

    expect(flattenMessagePages(pages).map((m) => m._id)).toEqual(['1', '2', '3', '4']);
  });

  it('returns an empty array for no pages', () => {
    expect(flattenMessagePages([])).toEqual([]);
  });
});

describe('isGroupStart', () => {
  it('is a group start when there is no previous message', () => {
    expect(isGroupStart(msg('1', '2026-01-01T00:00:00Z'), null)).toBe(true);
  });

  it('is not a group start for the same sender within the grouping window', () => {
    const previous = msg('1', '2026-01-01T00:00:00Z', 'u1');
    const current = msg('2', '2026-01-01T00:02:00Z', 'u1');
    expect(isGroupStart(current, previous)).toBe(false);
  });

  it('is a group start when the sender changes', () => {
    const previous = msg('1', '2026-01-01T00:00:00Z', 'u1');
    const current = msg('2', '2026-01-01T00:01:00Z', 'u2');
    expect(isGroupStart(current, previous)).toBe(true);
  });

  it('is a group start when the gap since the previous message exceeds the grouping window', () => {
    const previous = msg('1', '2026-01-01T00:00:00Z', 'u1');
    const current = msg('2', '2026-01-01T00:06:00Z', 'u1');
    expect(isGroupStart(current, previous)).toBe(true);
  });
});
