import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';

let app;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);
beforeEach(() => {
  // A fresh app per test gives each test its own rate-limiter store, so
  // these tests never interfere with each other or with other files.
  app = createApp();
});

describe('rate limiting', () => {
  it('throttles /api/auth/register beyond 10 requests / 15 min / IP with a clean 429', async () => {
    const responses = [];
    for (let i = 0; i < 11; i += 1) {
      // Unique email per attempt so the limiter — not EMAIL_TAKEN — is
      // what's actually being exercised.
      responses.push(
        await request(app)
          .post('/api/auth/register')
          .send({
            email: `user${i}@example.com`,
            password: 'correct-horse',
            displayName: 'Test User',
          })
      );
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses[10]).toBe(429);
    expect(responses[10].body.error.code).toBe('RATE_LIMITED');
  });

  it('throttles /api/auth/login beyond 10 requests / 15 min / IP with a clean 429', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'ada@example.com', password: 'correct-horse', displayName: 'Ada' });

    const responses = [];
    for (let i = 0; i < 11; i += 1) {
      responses.push(
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'ada@example.com', password: 'wrong-password' })
      );
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('login and register have independent rate-limit budgets', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: `budget${i}@example.com`,
          password: 'correct-horse',
          displayName: 'Test User',
        });
    }

    // Register's budget of 10 is now exhausted; login must be unaffected.
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });

    expect(loginRes.status).toBe(401); // not 429 — login has its own bucket
  });

  it('throttles /api/auth/refresh beyond 30 requests / 15 min / IP with a clean 429', async () => {
    const responses = [];
    for (let i = 0; i < 31; i += 1) {
      responses.push(await request(app).post('/api/auth/refresh'));
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
