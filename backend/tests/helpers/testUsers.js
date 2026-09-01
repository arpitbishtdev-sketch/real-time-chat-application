import { randomUUID } from 'node:crypto';
import request from 'supertest';

function getCookie(res, name) {
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.find((c) => c.startsWith(`${name}=`)) ?? null;
}

function cookieValue(rawCookie) {
  return rawCookie.split(';')[0].split('=').slice(1).join('=');
}

// Registers a fresh user and returns the pieces every M3+ integration test
// needs: the created user, and a ready-to-use `Cookie` header value for
// authenticating subsequent requests as them.
export async function registerUser(app, overrides = {}) {
  const payload = {
    email: `user-${randomUUID()}@example.com`,
    password: 'correct-horse',
    displayName: 'Test User',
    ...overrides,
  };

  const res = await request(app).post('/api/auth/register').send(payload);
  const accessToken = cookieValue(getCookie(res, 'accessToken'));

  return {
    user: res.body.user,
    accessToken,
    authCookie: `accessToken=${accessToken}`,
  };
}
