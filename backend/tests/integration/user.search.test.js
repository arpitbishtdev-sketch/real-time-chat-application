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

describe('GET /api/users/search', () => {
  it('matches case-insensitively and excludes the requester', async () => {
    const { authCookie } = await registerUser(app, { displayName: 'Ada Lovelace' });
    await registerUser(app, { displayName: 'Grace Hopper' });
    await registerUser(app, { displayName: 'Adam Smith' });

    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'ada' })
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    const names = res.body.users.map((u) => u.displayName);
    expect(names).toContain('Adam Smith');
    expect(names).not.toContain('Ada Lovelace'); // requester excluded
    expect(names).not.toContain('Grace Hopper');
  });

  it('matches as a substring, not only a prefix', async () => {
    const { authCookie } = await registerUser(app);
    await registerUser(app, { displayName: 'Grace Hopper' });

    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'hopper' })
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.displayName)).toContain('Grace Hopper');
  });

  it('never returns passwordHash or email for search results', async () => {
    const { authCookie } = await registerUser(app);
    await registerUser(app, { displayName: 'Grace Hopper' });

    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'grace' })
      .set('Cookie', [authCookie]);

    expect(res.body.users[0]).not.toHaveProperty('passwordHash');
    expect(res.body.users[0]).not.toHaveProperty('email');
  });

  it('treats regex special characters in the query as literal text, not a pattern', async () => {
    const { authCookie } = await registerUser(app);
    await registerUser(app, { displayName: 'A.B Corp' });
    await registerUser(app, { displayName: 'AxB Corp' });

    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'a.b' })
      .set('Cookie', [authCookie]);

    const names = res.body.users.map((u) => u.displayName);
    expect(names).toContain('A.B Corp');
    expect(names).not.toContain('AxB Corp');
  });

  it('rejects a missing query with 400 VALIDATION_ERROR', async () => {
    const { authCookie } = await registerUser(app);

    const res = await request(app).get('/api/users/search').set('Cookie', [authCookie]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
