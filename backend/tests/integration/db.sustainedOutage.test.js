import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createApp } from '../../src/app.js';

// PROJECT_SPEC.md M10 task 7 / TESTING.md #31 — the existing single-write-
// failure coverage doesn't exercise a *sustained* outage or its recovery,
// only one mocked-throw call. This test manages its own MongoMemoryServer
// and mongoose connection end-to-end (not the shared tests/helpers/
// mongoMemory.js beforeAll/afterAll pair every other integration test
// uses) because it needs to actually stop and restart the real mongod
// process mid-test, which that shared helper doesn't expose.
//
// Critically, the connection here mirrors config/db.js's production
// options exactly (`bufferCommands: false` + `serverSelectionTimeoutMS:
// 5000`) rather than mongoMemory.js's connect(), which omits
// `bufferCommands: false` — without it, Mongoose's default behavior
// queues operations for up to `bufferTimeoutMS` (10s) while disconnected
// instead of failing fast via server selection, which would silently test
// a different (unbounded-by-the-documented-window) failure mode than the
// one BACKEND.md §12 actually documents and this test needs to verify.

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function extractAccessCookie(res) {
  const raw = res.headers['set-cookie'].find((c) => c.startsWith('accessToken='));
  const token = raw.split(';')[0].split('=').slice(1).join('=');
  return `accessToken=${token}`;
}

// Recovery is proven with a *fresh* write (a new registration), not by
// re-reading the pre-outage user. An abrupt `mongod.stop()` — even with
// `doCleanup: false` — isn't guaranteed to preserve a write that landed
// only moments before the kill and hadn't reached a WiredTiger checkpoint
// yet (observed directly: the pre-outage user was occasionally gone after
// restart even though the connection itself had fully recovered). That's a
// property of this ephemeral test double's abrupt-kill timing, not a claim
// this app's architecture makes or that TESTING.md #31 requires — #31 is
// about the app cleanly failing during the outage and cleanly resuming
// service after, not about zero-data-loss across the database's own
// restart (that durability question, across an *app* restart with Mongo
// staying up throughout, is what M9's real-process-restart harness already
// covers). A brand-new write after recovery proves the connection and
// query path are fully functional again either way.
async function waitForRecovery(app, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await request(app)
        .post('/api/auth/register')
        .send({
          email: `user-${randomUUID()}@example.com`,
          password: 'correct-horse',
          displayName: 'Post-Recovery',
        });
      if (last.status === 201) return last;
    } catch (err) {
      // A transient error mid-recovery (e.g. the driver still rediscovering
      // topology) is just another reason to keep polling, not a failure.
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Never recovered within ${timeoutMs}ms (last saw ${last?.status ?? last})`);
}

describe('Sustained MongoDB outage & recovery (TESTING.md #31)', () => {
  let mongod;

  afterEach(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop({ doCleanup: true });
      mongod = null;
    }
  });

  it('fails requests cleanly and within the bounded timeout during an outage, then recovers automatically once Mongo returns, with no app restart', async () => {
    const port = await getFreePort();
    mongod = await MongoMemoryServer.create({ instance: { port } });

    mongoose.set('bufferCommands', false);
    await mongoose.connect(mongod.getUri(), {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false,
    });
    await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));

    const app = createApp();

    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `user-${randomUUID()}@example.com`,
        password: 'correct-horse',
        displayName: 'Ada',
      });
    expect(registerRes.status).toBe(201);
    const authCookie = extractAccessCookie(registerRes);

    const sanityRes = await request(app).get('/api/users/me').set('Cookie', [authCookie]);
    expect(sanityRes.status).toBe(200);

    // The outage: stop the real mongod without the app doing anything —
    // this is what a crash/network partition looks like from Express's
    // side, not a graceful, app-initiated disconnect.
    await mongod.stop({ doCleanup: false });

    const start = Date.now();
    const duringOutage = await request(app).get('/api/users/me').set('Cookie', [authCookie]);
    const elapsedMs = Date.now() - start;

    // Clean failure, never a hang — bounded well within a small multiple
    // of the 5s serverSelectionTimeoutMS, not "eventually" or "never."
    expect(duringOutage.status).toBe(500);
    expect(duringOutage.body.error.code).toBe('INTERNAL_ERROR');
    expect(elapsedMs).toBeLessThan(8000);

    // A second request during the same outage also fails cleanly — the
    // process itself is still alive and serving, just the DB is down.
    const duringOutage2 = await request(app).get('/api/users/me').set('Cookie', [authCookie]);
    expect(duringOutage2.status).toBe(500);

    // Recovery: bring Mongo back on the exact same port, no app restart.
    await mongod.start(true);

    // Generous ceiling — under a full parallel test-suite run, many other
    // files' own mongod instances are competing for CPU/IO at the same
    // time, so this restart can legitimately take longer than it would in
    // isolation. Polling (not a fixed sleep) means this returns as soon as
    // recovery actually happens, not after a fixed worst-case wait.
    const afterRecovery = await waitForRecovery(app, 40000);
    expect(afterRecovery.status).toBe(201);
    expect(afterRecovery.body.user.displayName).toBe('Post-Recovery');

    // The read path recovered too, not just writes — fetch the user just
    // created above (never at risk of the pre-outage-write timing issue
    // described above, since it was written well after Mongo came back).
    const newAuthCookie = extractAccessCookie(afterRecovery);
    const readAfterRecovery = await request(app)
      .get('/api/users/me')
      .set('Cookie', [newAuthCookie]);
    expect(readAfterRecovery.status).toBe(200);
  }, 60000);
});
