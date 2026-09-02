import { messageSendSchema } from '../validation/socket.schema.js';
import { sendMessage, shapeMessage } from '../services/conversation.service.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export function createMessageChains() {
  return new Map();
}

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

function toAckError(err) {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  console.error(err);
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'An unexpected error occurred.' : err.message,
    },
  };
}

// Chains message:send persistence per conversation so rapid same-sender
// sends persist — and therefore receive their `createdAt` — in the order
// they were actually sent, not in whatever order their individual DB
// writes happen to complete (BACKEND.md §13c). `task` never throws (all
// error paths are handled internally so the ack always fires), so the
// stored chain tail is never a rejected promise.
function chain(chains, conversationId, task) {
  const previous = chains.get(conversationId) ?? Promise.resolve();
  const next = previous.then(task);
  chains.set(conversationId, next);
  return next;
}

export function registerMessageHandlers(socket, io, chains) {
  socket.on('message:send', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    const parsed = messageSendSchema.safeParse(payload);
    if (!parsed.success) {
      return reply({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid message payload is required.' },
      });
    }

    const { conversationId, clientMessageId, text } = parsed.data;

    chain(chains, conversationId, async () => {
      let result;
      try {
        result = await sendMessage(conversationId, socket.userId, { clientMessageId, text });
      } catch (err) {
        reply(toAckError(err));
        return;
      }

      // Duplicate-retry branch: the message already existed and nothing
      // further was written (REALTIME.md §13) — ack the original message,
      // but don't re-broadcast a message every online recipient already saw.
      if (!result.created) {
        reply({ ok: true, message: shapeMessage(result.message) });
        return;
      }

      const shaped = shapeMessage(result.message);
      // Ack reflects persistence success only — sent before, and
      // independent of, the broadcast attempt below (BACKEND.md §13d,
      // REALTIME.md §12a).
      reply({ ok: true, message: shaped });

      try {
        io.to(roomName(conversationId)).emit('message:new', { message: shaped });
      } catch (err) {
        // A failed live broadcast is never a correctness problem — any
        // client that missed it recovers via reconnection/history sync
        // (REALTIME.md §12a/§19) — so it's logged only, never re-thrown.
        console.error(err);
      }
    });
  });
}
