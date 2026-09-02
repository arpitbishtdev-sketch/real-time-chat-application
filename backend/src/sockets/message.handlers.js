import {
  messageSendSchema,
  messageDeliveredSchema,
  messageReadSchema,
} from '../validation/socket.schema.js';
import {
  sendMessage,
  shapeMessage,
  assertParticipant,
  markMessageDelivered,
  markConversationRead,
} from '../services/conversation.service.js';
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

export function registerMessageHandlers(socket, io, chains, messageRateLimiter) {
  socket.on('message:send', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    // Rate-limited per authenticated userId, before validation — bounds the
    // total rate of message:send *attempts* a user can make regardless of
    // payload validity (a flood of malformed payloads is exactly as much
    // of an abuse surface as a flood of valid ones), and per-user rather
    // than per-socket so multi-tab/device spam from the same user is also
    // bounded (REALTIME.md §25, PROJECT_SPEC.md M10 task 4). The socket is
    // never disconnected for this — only this one event is rejected.
    if (!messageRateLimiter.tryConsume(socket.userId)) {
      return reply({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many messages. Please slow down.' },
      });
    }

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

  socket.on('message:delivered', async (payload) => {
    const parsed = messageDeliveredSchema.safeParse(payload);
    if (!parsed.success) {
      // No ack exists for this event; malformed payload is silently
      // dropped, same as a non-participant/nonexistent message below — the
      // event table deliberately never surfaces an error here, to avoid
      // leaking whether a given messageId exists (REALTIME.md §11).
      return;
    }

    const { conversationId, messageId } = parsed.data;

    let result;
    try {
      result = await markMessageDelivered(conversationId, messageId, socket.userId);
    } catch (err) {
      if (!(err instanceof AppError)) {
        console.error(err);
      }
      return;
    }

    if (!result) {
      // No-op: message isn't in this conversation, or was already at
      // `delivered`/`read` — nothing changed, nothing to broadcast.
      return;
    }

    try {
      io.to(`user:${result.senderId}`).emit('message:status', {
        conversationId,
        messageId: result.messageId,
        status: 'delivered',
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('message:read', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    const parsed = messageReadSchema.safeParse(payload);
    if (!parsed.success) {
      return reply({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid read payload is required.' },
      });
    }

    const { conversationId, upToMessageId } = parsed.data;

    try {
      await assertParticipant(conversationId, socket.userId);
    } catch (err) {
      return reply(toAckError(err));
    }

    let result;
    try {
      result = await markConversationRead(conversationId, socket.userId, upToMessageId);
    } catch (err) {
      return reply(toAckError(err));
    }

    // Ack reflects persistence success only, sent before the broadcast
    // attempt below — same ack/broadcast isolation as message:send
    // (BACKEND.md §13d, REALTIME.md §12a).
    reply({ ok: true });

    if (result.modifiedCount > 0) {
      try {
        io.to(`user:${result.otherParticipantId}`).emit('message:status', {
          conversationId,
          upToMessageId,
          status: 'read',
        });
      } catch (err) {
        console.error(err);
      }
    }
  });
}
