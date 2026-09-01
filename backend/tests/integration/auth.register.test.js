import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Session } from '../../src/models/Session.js';
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

describe('POST /api/auth/register', () => {
  it('creates a user, a session, and sets both cookies', async () => {
    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(payload.email);
    expect(res.body.user.displayName).toBe(payload.displayName);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie.some((c) => c.startsWith('accessToken='))).toBe(true);
    const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/Path=\/api\/auth/);
    expect(refreshCookie).toMatch(/HttpOnly/i);

    const sessionCount = await Session.countDocuments({});
    expect(sessionCount).toBe(1);
  });

  it('never returns passwordHash anywhere in the response', async () => {
    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.text).not.toContain('passwordHash');
    expect(res.text).not.toContain(payload.password);
  });

  it('actually hashes the password with bcrypt, not storing it in plaintext', async () => {
    await request(app).post('/api/auth/register').send(payload);

    const stored = await User.findOne({ email: payload.email }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(payload.password);
    expect(await bcrypt.compare(payload.password, stored.passwordHash)).toBe(true);
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN and creates no second user', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');

    const count = await User.countDocuments({ email: payload.email });
    expect(count).toBe(1);
  });

  it('treats email case-insensitively for the duplicate check', async () => {
    await request(app).post('/api/auth/register').send(payload);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...payload, email: 'ADA@EXAMPLE.COM' });

    expect(res.status).toBe(409);
  });

  it('rejects an invalid payload with 400 VALIDATION_ERROR before touching the database', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: 'A' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);

    const count = await User.countDocuments({});
    expect(count).toBe(0);
  });

  it('rejects a spoofed extra field (e.g. a client-supplied passwordHash) rather than storing it', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...payload, passwordHash: 'attacker-controlled-hash' });

    expect(res.status).toBe(201);
    const stored = await User.findOne({ email: payload.email }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe('attacker-controlled-hash');
  });
});
