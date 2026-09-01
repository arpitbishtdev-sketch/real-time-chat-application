import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadSchema,
  conversationIdParamSchema,
} from '../../src/validation/conversation.schema.js';

const validId = new mongoose.Types.ObjectId().toString();

describe('createConversationSchema', () => {
  it('accepts a valid ObjectId string', () => {
    expect(createConversationSchema.safeParse({ participantId: validId }).success).toBe(true);
  });

  it('rejects a non-ObjectId string', () => {
    expect(createConversationSchema.safeParse({ participantId: 'nope' }).success).toBe(false);
  });

  it('rejects a missing participantId', () => {
    expect(createConversationSchema.safeParse({}).success).toBe(false);
  });
});

describe('conversationIdParamSchema', () => {
  it('accepts a valid ObjectId, rejects a malformed one', () => {
    expect(conversationIdParamSchema.safeParse({ id: validId }).success).toBe(true);
    expect(conversationIdParamSchema.safeParse({ id: 'malformed' }).success).toBe(false);
  });
});

describe('listConversationsQuerySchema / listMessagesQuerySchema', () => {
  it('defaults limit when omitted', () => {
    const conv = listConversationsQuerySchema.parse({});
    const msgs = listMessagesQuerySchema.parse({});
    expect(conv.limit).toBe(20);
    expect(msgs.limit).toBe(30);
  });

  it('coerces a string query-param limit to a number', () => {
    expect(listConversationsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
  });

  it('rejects a limit beyond the max', () => {
    expect(listConversationsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listMessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects a non-integer limit', () => {
    expect(listConversationsQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
  });
});

describe('markReadSchema', () => {
  it('accepts a valid ObjectId, rejects a malformed one', () => {
    expect(markReadSchema.safeParse({ upToMessageId: validId }).success).toBe(true);
    expect(markReadSchema.safeParse({ upToMessageId: 'bad' }).success).toBe(false);
    expect(markReadSchema.safeParse({}).success).toBe(false);
  });
});
