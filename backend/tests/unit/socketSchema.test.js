import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

import { conversationRoomSchema, messageSendSchema } from '../../src/validation/socket.schema.js';

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

describe('messageSendSchema', () => {
  const clientMessageId = randomUUID();

  it('accepts a valid payload', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: 'hello there',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ conversationId: validId, clientMessageId, text: 'hello there' });
  });

  it('trims surrounding whitespace from text', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: '  hello there  ',
    });
    expect(result.success).toBe(true);
    expect(result.data.text).toBe('hello there');
  });

  it('rejects an empty string', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only string (after trim)', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: '     ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 4000 characters', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: 'a'.repeat(4000),
    });
    expect(result.success).toBe(true);
  });

  it('rejects 4001 characters', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: 'a'.repeat(4001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string text field', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: 12345,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing conversationId', () => {
    const result = messageSendSchema.safeParse({ clientMessageId, text: 'hi' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed conversationId', () => {
    const result = messageSendSchema.safeParse({
      conversationId: 'not-an-id',
      clientMessageId,
      text: 'hi',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing clientMessageId', () => {
    const result = messageSendSchema.safeParse({ conversationId: validId, text: 'hi' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID clientMessageId', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId: 'not-a-uuid',
      text: 'hi',
    });
    expect(result.success).toBe(false);
  });

  it('ignores a client-supplied senderId alongside the documented fields', () => {
    const result = messageSendSchema.safeParse({
      conversationId: validId,
      clientMessageId,
      text: 'hi',
      senderId: 'evil',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ conversationId: validId, clientMessageId, text: 'hi' });
  });
});
