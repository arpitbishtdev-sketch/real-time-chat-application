import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../../src/app.js';
import { Session } from '../../src/models/Session.js';
import { signRefreshToken } from '../../src/utils/tokens.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';

let app;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);
beforeEach(() => {
  app = createApp();
});

const payload = {
  email: 'ada@example.com',
  password: 'correct-horse',
  displayName: 'Ada Lovelace',
};

function getCookie(res, name) {
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.find((c) => c.startsWith(`${name}=`)) ?? null;
}

function cookieValue(rawCookie) {
  return rawCookie.split(';')[0].split('=').slice(1).join('=');
}

async function registerAndCapture(app_) {
  const res = await request(app_).post('/api/auth/register').send(payload);
  const userId = res.body.user._id ?? res.body.user.id;
  return {
    userId,
    accessToken: cookieValue(getCookie(res, 'accessToken')),
    refreshToken: cookieValue(getCookie(res, 'refreshToken')),
  };
}

describe('authenticate middleware (exercised via protected auth routes)', () => {
  it('rejects a request with no accessToken cookie at all: 401 NO_TOKEN', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TOKEN');
  });

  it('rejects a garbage accessToken cookie: 401 INVALID_TOKEN', async () => {
    const res = await request(app).post('/api/auth/logout').set('Cookie', ['accessToken=garbage']);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired accessToken cookie: 401 INVALID_TOKEN', async () => {
    const jwt = await import('jsonwebtoken');
    const { env } = await import('../../src/config/env.js');
    const expired = jwt.default.sign(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 },
      env.jwt.accessSecret
    );

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${expired}`]);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('never leaks JWT internals in the error body', async () => {
    const res = await request(app).post('/api/auth/logout').set('Cookie', ['accessToken=garbage']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message']);
  });

  it('accepts a valid accessToken cookie', async () => {
    const { accessToken } = await registerAndCapture(app);
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${accessToken}`]);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/refresh', () => {
  it('issues a new accessToken given a valid refreshToken cookie', async () => {
    const { refreshToken, userId } = await registerAndCapture(app);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(200);
    const newAccessCookie = getCookie(res, 'accessToken');
    expect(newAccessCookie).toBeDefined();

    const { verifyAccessToken } = await import('../../src/utils/tokens.js');
    const decoded = verifyAccessToken(cookieValue(newAccessCookie));
    expect(decoded.sub).toBe(String(userId));
  });

  it('rejects with 401 INVALID_REFRESH_TOKEN when no refreshToken cookie is present', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a malformed refreshToken cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=garbage']);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a refresh token whose sid matches no Session document', async () => {
    const { userId } = await registerAndCapture(app);
    const fakeSid = new mongoose.Types.ObjectId().toString();
    const forged = signRefreshToken(userId, fakeSid);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', [`refreshToken=${forged}`]);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a refresh token whose sid belongs to a different user than its own sub claim', async () => {
    const userA = await registerAndCapture(app);
    const userB = await request(app)
      .post('/api/auth/register')
      .send({ email: 'grace@example.com', password: 'correct-horse', displayName: 'Grace' });
    const userBId = userB.body.user._id ?? userB.body.user.id;

    const session = await Session.findOne({ userId: userA.userId });
    const forged = signRefreshToken(userBId, session._id); // sub=B, sid=A's session

    const res = await request(app).post('/api/auth/refresh').set('Cookie', [`refreshToken=${forged}`]);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a session that is past its own expiresAt, even before the TTL reaper deletes it', async () => {
    const { refreshToken } = await registerAndCapture(app);
    const session = await Session.findOne({});
    session.expiresAt = new Date(Date.now() - 1000);
    await session.save();

    // The document still physically exists — proving the app-level check
    // catches it independent of MongoDB's background TTL sweep.
    const stillExists = await Session.findById(session._id);
    expect(stillExists).not.toBeNull();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a refresh token whose session was already deleted by logout (revoked session)', async () => {
    const { accessToken, refreshToken } = await registerAndCapture(app);

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${accessToken}`, `refreshToken=${refreshToken}`]);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes exactly the caller\'s own session', async () => {
    const { accessToken, refreshToken } = await registerAndCapture(app);
    expect(await Session.countDocuments({})).toBe(1);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${accessToken}`, `refreshToken=${refreshToken}`]);

    expect(res.status).toBe(200);
    expect(await Session.countDocuments({})).toBe(0);
  });

  it('clears both cookies on the response', async () => {
    const { accessToken, refreshToken } = await registerAndCapture(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${accessToken}`, `refreshToken=${refreshToken}`]);

    const clearedAccess = getCookie(res, 'accessToken');
    const clearedRefresh = getCookie(res, 'refreshToken');
    expect(clearedAccess).toMatch(/Expires=/);
    expect(clearedRefresh).toMatch(/Expires=/);
  });

  it('succeeds without crashing when only the accessToken cookie is present (no session identifiable)', async () => {
    const { accessToken } = await registerAndCapture(app);
    expect(await Session.countDocuments({})).toBe(1);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${accessToken}`]);

    expect(res.status).toBe(200);
    // Nothing was identifiable to delete — the session survives.
    expect(await Session.countDocuments({})).toBe(1);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});
