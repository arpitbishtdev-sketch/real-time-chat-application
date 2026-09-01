import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

// Kept in one place (ms) so REST cookie maxAge and the JWT's own expiry
// can never drift apart.
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(userId) {
  return jwt.sign({ sub: String(userId) }, env.jwt.accessSecret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(userId, sessionId) {
  return jwt.sign({ sub: String(userId), sid: String(sessionId) }, env.jwt.refreshSecret, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

// Both throw jsonwebtoken's own errors (TokenExpiredError, JsonWebTokenError)
// on failure — callers translate those into domain errors (AppError).
// This module stays a dumb, framework-agnostic primitive so M4's Socket.IO
// handshake middleware (REALTIME.md §5) can reuse verifyAccessToken as-is.
export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}
