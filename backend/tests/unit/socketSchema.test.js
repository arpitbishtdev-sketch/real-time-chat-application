import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { conversationRoomSchema } from '../../src/validation/socket.schema.js';

const validId = new mongoose.Types.ObjectId().toString();

describe('conversationRoomSchema', () => {
  it('accepts a valid ObjectId string', () => {
    expect(conversationRoomSchema.safeParse({ conversationId: validId }).success).toBe(true);
  });

  it('rejects a non-ObjectId string', () => {
    expect(conversationRoomSchema.safeParse({ conversationId: 'nope' }).success).toBe(false);
  });

  it('rejects a missing conversationId', () => {
    expect(conversationRoomSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string conversationId', () => {
    expect(conversationRoomSchema.safeParse({ conversationId: 12345 }).success).toBe(false);
  });

  it('rejects an unexpected extra field silently swallowed as identity spoofing attempt', () => {
    // A client-supplied userId alongside conversationId must never be read by
    // any handler — this schema only ever produces {conversationId}.
    const result = conversationRoomSchema.safeParse({ conversationId: validId, userId: 'evil' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ conversationId: validId });
  });
});
