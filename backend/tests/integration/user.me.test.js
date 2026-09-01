import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';

let app;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);
beforeEach(() => {
  app = createApp();
});

describe('GET /api/users/me', () => {
  it('returns the authenticated user, never passwordHash', async () => {
    const { user, authCookie } = await registerUser(app, { displayName: 'Ada Lovelace' });

    const res = await request(app).get('/api/users/me').set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.user._id).toBe(user._id);
    expect(res.body.user.displayName).toBe('Ada Lovelace');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TOKEN');
  });
});

describe('PATCH /api/users/me', () => {
  it('updates allowed fields and returns the updated user', async () => {
    const { authCookie } = await registerUser(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', [authCookie])
      .send({ displayName: 'New Name', statusText: 'busy', avatarUrl: 'https://example.com/a.png' });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('New Name');
    expect(res.body.user.statusText).toBe('busy');
    expect(res.body.user.avatarUrl).toBe('https://example.com/a.png');
  });

  it('rejects an invalid field value with 400 VALIDATION_ERROR', async () => {
    const { authCookie } = await registerUser(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', [authCookie])
      .send({ avatarUrl: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores an attempt to overwrite email or passwordHash via the body', async () => {
    const { user, authCookie } = await registerUser(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', [authCookie])
      .send({ email: 'attacker@example.com', passwordHash: 'hijacked' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
  });
});
