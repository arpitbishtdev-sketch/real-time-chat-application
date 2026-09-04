import { describe, it, expect, beforeEach } from 'vitest';

import { usePresenceStore } from '../src/store/presenceStore.js';

// PROJECT_SPEC.md M15 task 1 — presenceStore is the single source of truth
// for live "is this contact online" state, keyed per-user (not per-socket,
// REALTIME.md §8) and bootstrapped from REST only when nothing live is
// known yet.
describe('presenceStore', () => {
  beforeEach(() => {
    // Merge, not replace — a replace would also wipe the action methods
    // (setOnline/setOffline/seedLastSeen) defined alongside this state.
    usePresenceStore.setState({ onlineUserIds: new Set(), lastSeenByUserId: {} });
  });

  it('setOnline marks a user online', () => {
    usePresenceStore.getState().setOnline('u1');
    expect(usePresenceStore.getState().onlineUserIds.has('u1')).toBe(true);
  });

  it('setOffline marks a user offline and records lastSeenAt', () => {
    usePresenceStore.getState().setOnline('u1');
    usePresenceStore.getState().setOffline('u1', '2026-01-10T00:00:00Z');

    expect(usePresenceStore.getState().onlineUserIds.has('u1')).toBe(false);
    expect(usePresenceStore.getState().lastSeenByUserId.u1).toBe('2026-01-10T00:00:00Z');
  });

  it('setOffline defaults lastSeenAt to now when the server omits it', () => {
    usePresenceStore.getState().setOffline('u1', undefined);
    expect(usePresenceStore.getState().lastSeenByUserId.u1).toBeTruthy();
  });

  describe('seedLastSeen', () => {
    it('applies a REST-sourced lastSeenAt when nothing live is known yet', () => {
      usePresenceStore.getState().seedLastSeen('u1', '2026-01-09T00:00:00Z');
      expect(usePresenceStore.getState().lastSeenByUserId.u1).toBe('2026-01-09T00:00:00Z');
    });

    it('never overwrites a user already known online this session', () => {
      usePresenceStore.getState().setOnline('u1');
      usePresenceStore.getState().seedLastSeen('u1', '2026-01-09T00:00:00Z');

      expect(usePresenceStore.getState().onlineUserIds.has('u1')).toBe(true);
      expect(usePresenceStore.getState().lastSeenByUserId.u1).toBeUndefined();
    });

    it('is a no-op for a null/undefined REST lastSeenAt (ambiguous: online, or never seen)', () => {
      usePresenceStore.getState().seedLastSeen('u1', null);
      expect(usePresenceStore.getState().lastSeenByUserId.u1).toBeUndefined();
    });
  });
});
