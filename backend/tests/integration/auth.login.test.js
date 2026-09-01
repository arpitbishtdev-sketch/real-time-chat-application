import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
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

async function seedUser() {
  await request(app).post('/api/auth/register').send(payload);
}

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and sets both cookies', async () => {
    await seedUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: payload.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(payload.email);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie.some((c) => c.startsWith('accessToken='))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    await seedUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a nonexistent email with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives byte-for-byte identical error bodies for "wrong password" and "no such user" (no info leak)', async () => {
    await seedUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'wrong-password' });
    const noSuchUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });

    expect(wrongPassword.status).toBe(noSuchUser.status);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('never echoes the submitted password back in an error response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'super-secret-value' });

    expect(res.text).not.toContain('super-secret-value');
  });

  it('rejects an invalid payload with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a NoSQL-injection-shaped password (object instead of string)', async () => {
    await seedUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: { $gt: '' } });

    expect(res.status).toBe(400);
  });
});
