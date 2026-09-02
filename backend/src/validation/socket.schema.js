import { z } from 'zod';

import { objectId } from './common.schema.js';

// Shared payload shape for conversation:join and conversation:leave
// (REALTIME.md §10) — deliberately the only field ever read from either
// payload, so a client-supplied userId/senderId alongside it is never
// parsed through to a handler (TESTING.md #10).
export const conversationRoomSchema = z.object({
  conversationId: objectId,
});

// message:send payload (REALTIME.md §10). `text` is trimmed before length
// validation so a whitespace-only string is rejected regardless of any
// frontend disabling of the send button (TESTING.md #14). `clientMessageId`
// is a client-generated UUID reused across retries of the same logical
// send — the idempotency key BACKEND.md §14's unique compound index dedups
// on. Only these three fields are ever read — a client-supplied senderId
// alongside them is never parsed through to a handler (TESTING.md #10).
export const messageSendSchema = z.object({
  conversationId: objectId,
  clientMessageId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});
