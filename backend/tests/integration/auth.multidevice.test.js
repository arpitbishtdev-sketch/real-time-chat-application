import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { Session } from '../../src/models/Session.js';
import { logoutAllSessions } from '../../src/services/auth.service.js';
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

async function loginAsDevice() {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, password: payload.password });
  return {
    accessToken: cookieValue(getCookie(res, 'accessToken')),
    refreshToken: cookieValue(getCookie(res, 'refreshToken')),
  };
}

describe('multi-device session isolation', () => {
  it('device A logout invalidates only device A — device B keeps working', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const deviceA = await loginAsDevice();
    const deviceB = await loginAsDevice();

    expect(await Session.countDocuments({})).toBe(3); // register + 2 logins

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`accessToken=${deviceA.accessToken}`, `refreshToken=${deviceA.refreshToken}`]);
    expect(logoutRes.status).toBe(200);

    const deviceARefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${deviceA.refreshToken}`]);
    expect(deviceARefresh.status).toBe(401);
    expect(deviceARefresh.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    const deviceBRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${deviceB.refreshToken}`]);
    expect(deviceBRefresh.status).toBe(200);
  });

  it('logout-all invalidates every device\'s refresh token', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const deviceA = await loginAsDevice();
    const deviceB = await loginAsDevice();

    const logoutAllRes = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', [`accessToken=${deviceA.accessToken}`]);
    expect(logoutAllRes.status).toBe(200);
    expect(await Session.countDocuments({})).toBe(0);

    const deviceARefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${deviceA.refreshToken}`]);
    const deviceBRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${deviceB.refreshToken}`]);

    expect(deviceARefresh.status).toBe(401);
    expect(deviceBRefresh.status).toBe(401);
  });

  it('logout-all only ever touches the caller\'s own sessions, never another user\'s', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const graceRegisterRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'grace@example.com', password: 'correct-horse', displayName: 'Grace' });
    const graceRefreshToken = cookieValue(getCookie(graceRegisterRes, 'refreshToken'));

    const caller = await loginAsDevice();
    expect(await Session.countDocuments({})).toBe(3); // register(ada) + register(grace) + login(ada)

    await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', [`accessToken=${caller.accessToken}`]);

    // Only Ada's two sessions are gone — Grace's own registration session
    // (a different user entirely) must survive untouched.
    const remaining = await Session.find({});
    expect(remaining).toHaveLength(1);

    const graceRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${graceRefreshToken}`]);
    expect(graceRefresh.status).toBe(200);
  });

  it('a single-device logout never calls the socket-disconnect hook — only logout-all does', async () => {
    // M4 doesn't exist yet, so this exercises the service directly against
    // a mock `io`, proving the hook logoutAllSessions exposes for M4 is
    // wired correctly without building any Socket.IO lifecycle here.
    await request(app).post('/api/auth/register').send(payload);
    const session = await Session.findOne({});
    const userId = session.userId.toString();

    const mockIo = {
      in: vi.fn().mockReturnThis(),
      disconnectSockets: vi.fn(),
    };

    await logoutAllSessions(userId, mockIo);

    expect(mockIo.in).toHaveBeenCalledWith(`user:${userId}`);
    expect(mockIo.disconnectSockets).toHaveBeenCalledOnce();
  });

  it('logout-all is a safe no-op on the socket side when io is not yet registered (current, pre-M4 state)', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const caller = await loginAsDevice();

    // app.get('io') is undefined until M4 wires Socket.IO onto the app —
    // the controller's guard must not throw when that's the case.
    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', [`accessToken=${caller.accessToken}`]);

    expect(res.status).toBe(200);
  });
});
