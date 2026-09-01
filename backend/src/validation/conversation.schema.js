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
export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const markReadSchema = z.object({
  upToMessageId: objectId,
});

export const conversationIdParamSchema = z.object({
  id: objectId,
});
