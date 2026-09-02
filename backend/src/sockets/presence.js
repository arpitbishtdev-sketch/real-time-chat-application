import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';

// userId -> Set<socketId> (REALTIME.md §8). Built directly on M4's
// connection tracking — this is the exact same map M4 exposed as
// `io.userSockets`, just given the presence-handling logic it was always
// intended to grow (see M4's commit note and PROJECT_SPEC.md M7 task 1).
export function createPresenceMap() {
  return new Map();
}

function userRoom(userId) {
  return `user:${userId}`;
}

// Every user this userId shares at least one conversation with
// (REALTIME.md §16) — presence broadcasts are scoped to these contacts
// only, never global, bounding fan-out cost and avoiding leaking "who's
// online" to non-contacts.
async function contactRoomsFor(userId) {
  const conversations = await Conversation.find({ participants: userId }, 'participants').lean();
  const contactIds = new Set();
  for (const conversation of conversations) {
    for (const participant of conversation.participants) {
      const id = String(participant);
      if (id !== String(userId)) {
        contactIds.add(id);
      }
    }
  }
  return [...contactIds].map(userRoom);
}

// Adds a newly connected socket to the presence map and, only if it's this
// user's *first* active socket, marks them online: clears any stale
// `lastSeenAt` and broadcasts `presence:online` to their contacts. A
// user's second, third, ... socket (another tab/device) is a no-op beyond
// the map insert — they were already online, per-user not per-socket
// (REALTIME.md §8/§21/§22).
export async function handleSocketConnected(io, presenceMap, userId, socketId) {
  const isFirstSocket = !presenceMap.has(userId);
  if (isFirstSocket) {
    presenceMap.set(userId, new Set());
  }
  presenceMap.get(userId).add(socketId);

  if (!isFirstSocket) {
    return;
  }

  await User.updateOne({ _id: userId }, { $unset: { lastSeenAt: '' } });
  const rooms = await contactRoomsFor(userId);
  if (rooms.length > 0) {
    io.to(rooms).emit('presence:online', { userId: String(userId) });
  }
}

// Removes a disconnected socket from the presence map and, only if this
// was the user's *last* active socket, marks them offline: sets
// `lastSeenAt` and broadcasts `presence:offline`. Another still-connected
// socket for the same user (another tab/device) means the user stays
// online — never equate "one socket disconnected" with "user went
// offline" (REALTIME.md §8).
export async function handleSocketDisconnected(io, presenceMap, userId, socketId) {
  const sockets = presenceMap.get(userId);
  if (!sockets) {
    return;
  }
  sockets.delete(socketId);
  if (sockets.size > 0) {
    return;
  }
  presenceMap.delete(userId);

  const lastSeenAt = new Date();
  await User.updateOne({ _id: userId }, { $set: { lastSeenAt } });
  const rooms = await contactRoomsFor(userId);
  if (rooms.length > 0) {
    io.to(rooms).emit('presence:offline', {
      userId: String(userId),
      lastSeenAt: lastSeenAt.toISOString(),
    });
  }
}
