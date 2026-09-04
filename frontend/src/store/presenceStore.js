import { create } from 'zustand';

// FRONTEND.md §15, PROJECT_SPEC.md M15 task 1 — populated from
// presence:online/presence:offline events (useSocketConnection) plus a
// one-time REST bootstrap per contact (useConversations seeds
// lastSeenByUserId from otherParticipant.lastSeenAt so a first render has
// *something* to show before any live event has arrived this session).
// Once a contact's status has been observed live, only further live events
// update it — see seedLastSeen below for why REST never overwrites that.
export const usePresenceStore = create((set) => ({
  onlineUserIds: new Set(),
  lastSeenByUserId: {},

  setOnline(userId) {
    set((state) => {
      if (state.onlineUserIds.has(userId)) return state;
      const onlineUserIds = new Set(state.onlineUserIds);
      onlineUserIds.add(userId);
      return { onlineUserIds };
    });
  },

  setOffline(userId, lastSeenAt) {
    set((state) => {
      const onlineUserIds = new Set(state.onlineUserIds);
      onlineUserIds.delete(userId);
      return {
        onlineUserIds,
        lastSeenByUserId: {
          ...state.lastSeenByUserId,
          [userId]: lastSeenAt ?? new Date().toISOString(),
        },
      };
    });
  },

  // REST-sourced bootstrap only (useConversations.js). Never overwrites a
  // user this session already knows is online — a stale REST snapshot
  // (fetched before their presence:online event, or racing it) must never
  // regress a live "online" back to a stale last-seen timestamp. A REST
  // `lastSeenAt` of null/undefined means "currently online, or never
  // captured" — ambiguous either way, so it's never treated as evidence of
  // *online* on its own (REALTIME.md has no "current presence snapshot"
  // query beyond the live event stream); it simply leaves existing state
  // alone until a real presence:online event arrives.
  seedLastSeen(userId, lastSeenAt) {
    set((state) => {
      if (state.onlineUserIds.has(userId)) return state;
      if (!lastSeenAt || state.lastSeenByUserId[userId] === lastSeenAt) return state;
      return { lastSeenByUserId: { ...state.lastSeenByUserId, [userId]: lastSeenAt } };
    });
  },
}));

// Small colocated selector (mirrors the "read from presenceStore" pattern
// FRONTEND.md §3 describes for PresenceDot/LastSeenLabel) so consumers
// don't each re-derive "is this user online" from the raw Set/map shape.
// Two separate primitive selectors, not one selector returning an object —
// each is independently comparable via Object.is, so a change to
// `onlineUserIds` alone doesn't force a re-render of every consumer that
// only cares about `lastSeenAt`, and vice versa.
export function usePresence(userId) {
  const online = usePresenceStore((state) => Boolean(userId) && state.onlineUserIds.has(userId));
  const lastSeenAt = usePresenceStore((state) => (userId ? (state.lastSeenByUserId[userId] ?? null) : null));
  return { online, lastSeenAt };
}
