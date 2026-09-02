import { conversationRoomSchema } from '../validation/socket.schema.js';
import { assertParticipant } from '../services/conversation.service.js';

// Server-side TTL backstop (REALTIME.md §15) — auto-expires a typing
// indicator if `typing:stop` never arrives (client disconnects mid-type,
// tab crashes, etc). Overridable per Socket.IO server instance so tests
// don't have to wait out the real production window.
const DEFAULT_TYPING_TTL_MS = 5000;

// `${conversationId}:${userId}` -> Timeout, one entry per actively-typing
// (conversation, user) pair. Purely in-memory/ephemeral — typing state is
// never persisted (REALTIME.md §15 describes no such write).
export function createTypingState() {
  return new Map();
}

function typingKey(conversationId, userId) {
  return `${conversationId}:${userId}`;
}

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

// Excludes every socket belonging to the typer (all of their tabs/devices,
// via the `user:<id>` room every socket joins on connect — REALTIME.md
// §7/§21), not just the single emitting socket, per REALTIME.md §21's
// "typing:update ... does exclude the sender."
function broadcastTypingUpdate(io, conversationId, userId, isTyping) {
  io.to(roomName(conversationId))
    .except(`user:${userId}`)
    .emit('typing:update', { conversationId, userId: String(userId), isTyping });
}

export function registerTypingHandlers(
  socket,
  io,
  typingState,
  typingTtlMs = DEFAULT_TYPING_TTL_MS
) {
  socket.on('typing:start', async (payload) => {
    const parsed = conversationRoomSchema.safeParse(payload);
    if (!parsed.success) {
      // No ack exists for this event; typing is explicitly a non-critical,
      // best-effort notification (REALTIME.md §11) — malformed payloads
      // are dropped silently rather than surfaced as an `error` event.
      return;
    }

    const { conversationId } = parsed.data;
    try {
      await assertParticipant(conversationId, socket.userId);
    } catch {
      // Silently dropped for a non-participant — same non-critical framing
      // as above (REALTIME.md §11's `typing:start` row).
      return;
    }

    const key = typingKey(conversationId, socket.userId);
    clearTimeout(typingState.get(key));
    const timer = setTimeout(() => {
      typingState.delete(key);
      broadcastTypingUpdate(io, conversationId, socket.userId, false);
    }, typingTtlMs);
    timer.unref?.();
    typingState.set(key, timer);

    broadcastTypingUpdate(io, conversationId, socket.userId, true);
  });

  socket.on('typing:stop', async (payload) => {
    const parsed = conversationRoomSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }

    const { conversationId } = parsed.data;
    try {
      await assertParticipant(conversationId, socket.userId);
    } catch {
      return;
    }

    const key = typingKey(conversationId, socket.userId);
    clearTimeout(typingState.get(key));
    typingState.delete(key);

    broadcastTypingUpdate(io, conversationId, socket.userId, false);
  });
}
