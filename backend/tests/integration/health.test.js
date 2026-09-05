import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import * as mongoMemory from '../helpers/mongoMemory.js';

describe('GET /api/health', () => {
  const app = createApp();

  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('unknown route', () => {
  const app = createApp();

  it('returns a 404 error envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// PROJECT_SPEC.md M18 — readiness is distinct from liveness: it must fail
// while MongoDB is unreachable (TESTING.md #24, extended to this check
// specifically), while /api/health above stays 200 regardless, so an
// orchestrator can tell "unhealthy, restart me" apart from "healthy but
// temporarily can't serve traffic, just stop routing to me."
describe('GET /api/health/ready', () => {
  it('reports 503/unavailable when MongoDB has never connected, while liveness still reports ok', async () => {
    const app = createApp();

    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'unavailable', db: 'disconnected' });

    const live = await request(app).get('/api/health');
    expect(live.status).toBe(200);
  });

  describe('once MongoDB is connected', () => {
    beforeAll(async () => {
      await mongoMemory.connect();
    });

    afterAll(async () => {
      await mongoMemory.disconnect();
    });

    it('reports 200/ok', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', db: 'connected' });
    });
  });
});
