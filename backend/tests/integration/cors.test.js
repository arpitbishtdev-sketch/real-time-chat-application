import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

// PROJECT_SPEC.md M18 security/readiness audit — "CORS remains locked
// down." BACKEND.md §8 already documents CORS as restricted to the
// frontend's origin with credentials:true, but nothing exercised that
// restriction actually rejecting a foreign origin until now.
describe('CORS (BACKEND.md §8)', () => {
  const app = createApp();

  it('grants CORS access to the configured CLIENT_ORIGIN, with credentials allowed', async () => {
    const res = await request(app).get('/api/health').set('Origin', env.clientOrigin);

    expect(res.headers['access-control-allow-origin']).toBe(env.clientOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  // `cors` with a static origin string always emits that one fixed value —
  // CORS's actual browser-side enforcement then blocks a page running on
  // any OTHER origin from reading the response, because the browser sees
  // the ACAO value doesn't match its own origin. The security-relevant
  // property to test server-side is therefore not "is the header present,"
  // but "does the server ever reflect the caller's own (foreign) Origin
  // header back" — the actual vulnerable pattern this guards against is an
  // `origin: (origin, cb) => cb(null, origin)`-style reflection, or `origin:
  // '*'` combined with credentials:true (which browsers reject outright,
  // but is still worth never emitting).
  it('never reflects a foreign Origin header back — the allowed origin is always the fixed configured CLIENT_ORIGIN', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBe(env.clientOrigin);
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });

  it('never emits a wildcard "*" allowed origin (invalid alongside credentials:true, and a red flag on its own)', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
