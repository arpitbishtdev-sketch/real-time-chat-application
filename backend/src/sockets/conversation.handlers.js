import { conversationRoomSchema } from '../validation/socket.schema.js';
import { assertParticipant } from '../services/conversation.service.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

// "Latest intent wins" join/leave race guard (REALTIME.md §7, TESTING.md
// #27): conversation:join's membership check is async; conversation:leave
// is effectively synchronous. Keyed by `${socketId}:${conversationId}` so
// a leave that completes while an earlier join's check is still in flight
// is never overridden by that stale join once it resolves.
export function createIntentMap() {
  return new Map();
}

function intentKey(socketId, conversationId) {
  return `${socketId}:${conversationId}`;
}

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

function toAckError(err) {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  // Unexpected (programmer) error — log full detail server-side, same as
  // errorHandler.js does for REST, and never leak internals to the client
  // in production.
  console.error(err);
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'An unexpected error occurred.' : err.message,
    },
  };
}

export function registerConversationHandlers(socket, intentMap) {
  socket.on('conversation:join', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    const parsed = conversationRoomSchema.safeParse(payload);
    if (!parsed.success) {
      return reply({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid conversationId is required.' },
      });
    }

    const { conversationId } = parsed.data;
    const key = intentKey(socket.id, conversationId);
    intentMap.set(key, 'join');

    try {
      await assertParticipant(conversationId, socket.userId);
    } catch (err) {
      return reply(toAckError(err));
    }

    // Only actually join the room if a subsequent leave hasn't superseded
    // this join while the membership check was in flight.
    if (intentMap.get(key) === 'join') {
      socket.join(roomName(conversationId));
    }

    reply({ ok: true });
  });

  socket.on('conversation:leave', (payload) => {
    const parsed = conversationRoomSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('error', {
        code: 'VALIDATION_ERROR',
        message: 'A valid conversationId is required.',
      });
      return;
    }

    const { conversationId } = parsed.data;
    intentMap.set(intentKey(socket.id, conversationId), 'leave');
    socket.leave(roomName(conversationId));
  });
}

export function clearSocketIntents(intentMap, socketId) {
  const prefix = `${socketId}:`;
  for (const key of intentMap.keys()) {
    if (key.startsWith(prefix)) {
      intentMap.delete(key);
    }
  }
}
