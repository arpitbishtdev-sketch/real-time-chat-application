import { z } from 'zod';
import { objectId } from './common.schema.js';

export const createConversationSchema = z.object({
  participantId: objectId,
});

export const listConversationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// M3 wires the route/shape only — the query never touches a real Message
// document until M6 (BACKEND.md §12/PROJECT_SPEC.md M3 task 7). The cursor
// shape is still validated now so M6 doesn't inherit a loose contract.
// `after` is the M9 reconnection/missed-message-sync direction (REALTIME.md
// §19, BACKEND.md §12) — a raw message id (not an opaque cursor blob, unlike
// `cursor`), since the client already knows the id of the last message it
// has locally. Mutually exclusive with `cursor`: the two are different sort
// directions over the same collection, and combining them has no coherent
// meaning.
export const listMessagesQuerySchema = z
  .object({
    cursor: z.string().optional(),
    after: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((data) => !(data.cursor && data.after), {
    message: 'cursor and after are mutually exclusive.',
  });

export const markReadSchema = z.object({
  upToMessageId: objectId,
});

export const conversationIdParamSchema = z.object({
  id: objectId,
});
