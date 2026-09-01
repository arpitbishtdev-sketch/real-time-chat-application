import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

import { env } from '../../src/config/env.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../src/utils/tokens.js';

describe('access tokens', () => {
  it('round-trips the userId in the sub claim', () => {
    const token = signAccessToken('user-123');
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-123');
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-jwt')).toThrow();
  });

  it('rejects a token signed with the wrong secret', () => {
    const tampered = jwt.sign({ sub: 'user-123' }, 'a-completely-different-secret-value-1234', {
      expiresIn: '15m',
    });
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 },
      env.jwt.accessSecret
    );
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });
});

describe('refresh tokens', () => {
  it('round-trips the userId and sessionId', () => {
    const token = signRefreshToken('user-123', 'session-456');
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('user-123');
    expect(decoded.sid).toBe('session-456');
  });

  it('rejects a refresh token verified with the access-token secret (cross-purpose reuse)', () => {
    const refreshToken = signRefreshToken('user-123', 'session-456');
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });

  it('rejects an expired refresh token', () => {
    const expired = jwt.sign(
      { sub: 'user-123', sid: 'session-456', exp: Math.floor(Date.now() / 1000) - 10 },
      env.jwt.refreshSecret
    );
    expect(() => verifyRefreshToken(expired)).toThrow(/expired/i);
  });
});
