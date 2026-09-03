import { create } from 'zustand';

// Empty shell (PROJECT_SPEC.md M11 task 7) — populated by socket event
// handlers starting M15, once the socket client (M14) exists to write into
// it. Declared now so the shape is settled ahead of time rather than
// invented under a later milestone's time pressure.
export const usePresenceStore = create(() => ({
  onlineUserIds: new Set(),
  lastSeenByUserId: {},
}));
