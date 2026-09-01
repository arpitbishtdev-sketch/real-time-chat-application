import bcrypt from 'bcrypt';

import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { AppError } from '../utils/AppError.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../utils/tokens.js';

const BCRYPT_COST = 12;

async function createSession(userId) {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  return Session.create({ userId, expiresAt });
}

async function issueTokensForNewSession(userId) {
  const session = await createSession(userId);
  return {
    accessToken: signAccessToken(userId),
    refreshToken: signRefreshToken(userId, session._id),
  };
}

function invalidRefreshTokenError() {
  return new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token.');
}

export async function registerUser({ email, password, displayName }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user;
  try {
    user = await User.create({ email, passwordHash, displayName });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }

  const tokens = await issueTokensForNewSession(user._id);
  return { user, ...tokens };
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  // Same error for "no such user" and "wrong password" — never reveal
  // which one it was (TESTING.md's info-leakage concern).
  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const tokens = await issueTokensForNewSession(user._id);
  return { user, ...tokens };
}

export async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw invalidRefreshTokenError();
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw invalidRefreshTokenError();
  }

  const { sub: userId, sid: sessionId } = decoded;

  // Matching on both _id AND userId means a forged/mismatched sid (one
  // that exists but belongs to a different user than the token's own
  // `sub` claim) simply fails to match — no separate check needed.
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) {
    throw invalidRefreshTokenError();
  }

  // Defense in depth: don't rely on the TTL index's background timing
  // (BACKEND.md §6a) — a session past its own expiresAt is rejected here
  // even if MongoDB hasn't physically reaped it yet.
  if (session.expiresAt.getTime() <= Date.now()) {
    throw invalidRefreshTokenError();
  }

  return { accessToken: signAccessToken(userId) };
}

export async function logoutUser(refreshToken) {
  if (!refreshToken) return;

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    // Nothing valid to revoke — logout still succeeds from the caller's
    // perspective (the controller clears cookies regardless).
    return;
  }

  // Deletes only the one session identified by this token's own `sid` —
  // never any other device's (BACKEND.md §6a).
  await Session.deleteOne({ _id: decoded.sid, userId: decoded.sub });
}

export async function logoutAllSessions(userId, io) {
  await Session.deleteMany({ userId });

  // `io` is read from req.app.get('io') by the controller; server.js
  // registers it via app.set('io', io) right after creating the Socket.IO
  // server (M4). The `if` guard stays as defense in depth (e.g. a caller
  // that constructs an app without ever attaching a socket server), not
  // because this is expected to be unset in normal operation anymore.
  if (io) {
    io.in(`user:${userId}`).disconnectSockets();
  }
}
