import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../src/utils/cursor.js';

describe('cursor utils', () => {
  it('round-trips an object through encode/decode', () => {
    const payload = { lastMessageAt: '2026-01-01T00:00:00.000Z', id: 'abc123' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('round-trips a null field correctly', () => {
    const payload = { lastMessageAt: null, id: 'abc123' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('throws a clean error on a non-JSON payload', () => {
    expect(() => decodeCursor('###not-base64-json###')).toThrow('Malformed pagination cursor.');
  });

  it('throws a clean error on a JSON array (not an object)', () => {
    const arrayCursor = Buffer.from('[1,2,3]', 'utf8').toString('base64url');
    expect(() => decodeCursor(arrayCursor)).toThrow('Malformed pagination cursor.');
  });
});
