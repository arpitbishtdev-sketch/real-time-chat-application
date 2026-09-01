import { describe, it, expect } from 'vitest';
import { updateProfileSchema, searchUsersQuerySchema } from '../../src/validation/user.schema.js';

describe('updateProfileSchema', () => {
  it('accepts a partial update with just one field', () => {
    expect(updateProfileSchema.safeParse({ displayName: 'New Name' }).success).toBe(true);
  });

  it('accepts an empty object (no-op update)', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a displayName shorter than 2 chars', () => {
    expect(updateProfileSchema.safeParse({ displayName: 'A' }).success).toBe(false);
  });

  it('rejects a non-URL avatarUrl', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'not-a-url' }).success).toBe(false);
  });

  it('accepts a valid avatarUrl', () => {
    expect(
      updateProfileSchema.safeParse({ avatarUrl: 'https://example.com/a.png' }).success
    ).toBe(true);
  });

  it('rejects a statusText beyond 100 chars', () => {
    expect(updateProfileSchema.safeParse({ statusText: 'a'.repeat(101) }).success).toBe(false);
  });

  it('strips unrecognized fields rather than storing them', () => {
    const result = updateProfileSchema.parse({ displayName: 'Ok Name', passwordHash: 'hijack' });
    expect(result).not.toHaveProperty('passwordHash');
  });
});

describe('searchUsersQuerySchema', () => {
  it('requires a non-empty q', () => {
    expect(searchUsersQuerySchema.safeParse({}).success).toBe(false);
    expect(searchUsersQuerySchema.safeParse({ q: '' }).success).toBe(false);
  });

  it('defaults limit to 20 and coerces string input', () => {
    expect(searchUsersQuerySchema.parse({ q: 'a' }).limit).toBe(20);
    expect(searchUsersQuerySchema.parse({ q: 'a', limit: '10' }).limit).toBe(10);
  });

  it('rejects a limit beyond 50', () => {
    expect(searchUsersQuerySchema.safeParse({ q: 'a', limit: '51' }).success).toBe(false);
  });
});
