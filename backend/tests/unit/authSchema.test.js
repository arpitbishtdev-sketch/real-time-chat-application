import { describe, it, expect } from 'vitest';

import { registerSchema, loginSchema } from '../../src/validation/auth.schema.js';

describe('registerSchema', () => {
  const validPayload = {
    email: 'user@example.com',
    password: 'correct-horse',
    displayName: 'Ada',
  };

  it('accepts a valid payload', () => {
    const result = registerSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('normalizes email to lowercase and trims whitespace', () => {
    const result = registerSchema.safeParse({ ...validPayload, email: '  User@Example.COM  ' });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe('user@example.com');
  });

  it('rejects a malformed email', () => {
    const result = registerSchema.safeParse({ ...validPayload, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a password under 8 characters', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: 'short1' });
    expect(result.success).toBe(false);
  });

  it('accepts a password at exactly the 8-character boundary', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: '12345678' });
    expect(result.success).toBe(true);
  });

  it('rejects a password over the 72-character bcrypt boundary', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: 'a'.repeat(73) });
    expect(result.success).toBe(false);
  });

  it('rejects a displayName under 2 characters', () => {
    const result = registerSchema.safeParse({ ...validPayload, displayName: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing field', () => {
    const { password: _password, ...withoutPassword } = validPayload;
    const result = registerSchema.safeParse(withoutPassword);
    expect(result.success).toBe(false);
  });

  it('rejects a non-string email (NoSQL-injection-shaped payload)', () => {
    const result = registerSchema.safeParse({ ...validPayload, email: { $gt: '' } });
    expect(result.success).toBe(false);
  });

  it('strips unrecognized extra fields rather than erroring', () => {
    const result = registerSchema.safeParse({ ...validPayload, isAdmin: true });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('isAdmin');
  });
});

describe('loginSchema', () => {
  it('accepts a valid payload', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'anything' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing email', () => {
    const result = loginSchema.safeParse({ password: 'anything' });
    expect(result.success).toBe(false);
  });
});
