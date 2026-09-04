import { describe, it, expect } from 'vitest';

import { formatRelativeTime, formatMessageTime } from '../src/utils/formatTime.js';

// Duration-bucketed (not calendar-day-based) so the result doesn't depend
// on the local timezone a test happens to run in.
describe('formatRelativeTime', () => {
  const now = new Date('2026-01-10T12:00:00Z');

  it('shows "Just now" for a timestamp under a minute old', () => {
    expect(formatRelativeTime('2026-01-10T11:59:45Z', now)).toBe('Just now');
  });

  it('shows minutes for a timestamp under an hour old', () => {
    expect(formatRelativeTime('2026-01-10T11:45:00Z', now)).toBe('15m');
  });

  it('shows hours for a timestamp under a day old', () => {
    expect(formatRelativeTime('2026-01-10T09:00:00Z', now)).toBe('3h');
  });

  it('shows days for a timestamp under a week old', () => {
    expect(formatRelativeTime('2026-01-08T12:00:00Z', now)).toBe('2d');
  });

  it('returns an empty string for a null timestamp (no messages yet)', () => {
    expect(formatRelativeTime(null, now)).toBe('');
  });
});

describe('formatMessageTime', () => {
  it('formats a timestamp as a local time string', () => {
    expect(formatMessageTime('2026-01-10T09:05:00Z')).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)?$/i);
  });
});
