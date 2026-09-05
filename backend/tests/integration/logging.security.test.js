import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import * as mongoMemory from '../helpers/mongoMemory.js';

// PROJECT_SPEC.md M18 — "logs clearly distinguish operational vs.
// programmer errors and never contain secrets/passwords/tokens" is an
// explicit acceptance criterion, with a named testing requirement ("a test
// confirming sensitive fields never appear in log output"). An audit of
// every console.* call site in src/ (config/db.js, config/env.js,
// middleware/errorHandler.js, sockets/*) found none that log req.body or
// any request payload directly — this is the regression test that keeps
// that true, rather than relying on the audit staying accurate by hand.
//
// morgan (app.js's request logger) is skipped entirely under NODE_ENV=test
// (existing, deliberate behavior — keeps test output clean), so it can't be
// exercised dynamically here; it's audited statically instead: both
// built-in formats used ('combined'/'dev') log only method/url/status/
// response-time/user-agent-class fields, never a request body, cookie
// value, or Authorization header, by construction.
describe('Logging never leaks secrets (PROJECT_SPEC.md M18)', () => {
  let app;

  beforeAll(async () => {
    await mongoMemory.connect();
    app = createApp();
  });

  afterAll(async () => {
    await mongoMemory.disconnect();
  });

  afterEach(async () => {
    await mongoMemory.clearDatabase();
  });

  it('never writes a submitted password to console output across register, login, and a failed login', async () => {
    const secretPassword = 'Unique-Marker-Password-1234!!';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await request(app).post('/api/auth/register').send({
        email: 'logging-test@example.com',
        password: secretPassword,
        displayName: 'Logging Test',
      });

      await request(app).post('/api/auth/login').send({
        email: 'logging-test@example.com',
        password: secretPassword,
      });

      // The most likely place a naive implementation would accidentally
      // interpolate a submitted credential into an error/log line.
      await request(app).post('/api/auth/login').send({
        email: 'logging-test@example.com',
        password: 'a-completely-wrong-password',
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(allLoggedText).not.toContain(secretPassword);
    expect(allLoggedText).not.toContain('a-completely-wrong-password');
  });

  it('never writes the JWT signing secrets to console output during a normal request', async () => {
    const { env } = await import('../../src/config/env.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await request(app).post('/api/auth/register').send({
        email: 'secret-check@example.com',
        password: 'whatever-password-123',
        displayName: 'Secret Check',
      });
      // Deliberately trigger the unexpected-error branch of errorHandler.js
      // (console.error(err) with the full error object) via a malformed,
      // pre-auth-middleware request, to confirm even that path never leaks
      // the signing secrets baked into every issued JWT.
      await request(app).get('/api/conversations').set('Cookie', 'accessToken=not-a-real-jwt');
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(allLoggedText).not.toContain(env.jwt.accessSecret);
    expect(allLoggedText).not.toContain(env.jwt.refreshSecret);
  });
});
