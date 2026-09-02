import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient } from 'socket.io-client';

// PROJECT_SPEC.md M9 task 7 / TESTING.md #7 (strengthened 2026-08-31): a
// REAL child-process restart, not a simulated one — this is the only test
// in the suite that spawns `src/server.js` as an actual OS process rather
// than importing `createApp()`/`createSocketServer()` in-process
// (tests/helpers/testServer.js), specifically because in-process tests
// can't exercise "the presence Map genuinely no longer exists" the way a
// real process death does. Runs against a real mongod (via
// mongodb-memory-server, the same "real MongoDB instance" convention
// TESTING.md #31 already uses for the sustained-outage test) so durable
// data survival is verified against the real persistence layer, not a mock.
// Slower than the rest of the suite by design — belongs in the full CI
// run (M17), not the fast per-save loop.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');

const secrets = {
  access: randomBytes(32).toString('hex'),
  refresh: randomBytes(32).toString('hex'),
};

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

function spawnServer(port, mongoUri) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGODB_URI: mongoUri,
      CLIENT_ORIGIN: 'http://localhost:5173',
      JWT_ACCESS_SECRET: secrets.access,
      JWT_REFRESH_SECRET: secrets.refresh,
    },
    stdio: 'pipe',
  });
  // Captured only to surface in a failure message if the server never
  // becomes healthy — never asserted on directly.
  child.output = '';
  child.stdout.on('data', (chunk) => (child.output += chunk));
  child.stderr.on('data', (chunk) => (child.output += chunk));
  return child;
}

async function waitForHealth(port, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited early (code ${child.exitCode}):\n${child.output}`);
    }
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // Not accepting connections yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server on port ${port} never became healthy:\n${child.output}`);
}

function killChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
}

async function registerViaHttp(port, overrides = {}) {
  const payload = {
    email: `user-${randomUUID()}@example.com`,
    password: 'correct-horse',
    displayName: 'Test User',
    ...overrides,
  };
  const res = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  const setCookies = res.headers.getSetCookie();
  const accessCookieRaw = setCookies.find((c) => c.startsWith('accessToken='));
  const accessToken = accessCookieRaw.split(';')[0].split('=').slice(1).join('=');
  return { user: body.user, authCookie: `accessToken=${accessToken}` };
}

function connectSocket(port, authCookie) {
  return ioClient(`http://localhost:${port}`, {
    extraHeaders: { Cookie: authCookie },
    reconnection: false,
    forceNew: true,
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe('real process restart (TESTING.md #7, PROJECT_SPEC.md M9 task 7)', () => {
  let mongod;
  let child;

  afterEach(async () => {
    await killChild(child);
    child = null;
    if (mongod) {
      await mongod.stop();
      mongod = null;
    }
  });

  it('survives a real kill+restart: durable data intact, presence resets, retried send after restart creates no duplicate', async () => {
    mongod = await MongoMemoryServer.create();
    const port = await getFreePort();

    child = spawnServer(port, mongod.getUri());
    await waitForHealth(port, child);

    const a = await registerViaHttp(port, { displayName: 'Ada' });
    const b = await registerViaHttp(port, { displayName: 'Bob' });

    const convRes = await fetch(`http://localhost:${port}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: a.authCookie },
      body: JSON.stringify({ participantId: b.user._id }),
    });
    const { conversation } = await convRes.json();
    const conversationId = conversation._id;

    const socketA = connectSocket(port, a.authCookie);
    await waitForConnect(socketA);

    const clientMessageId = randomUUID();
    const firstAck = await emitAck(socketA, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'sent before the crash',
    });
    expect(firstAck.ok).toBe(true);
    const persistedMessageId = firstAck.message._id;

    socketA.close();

    // The real kill — not a graceful `server.close()`, and not merely
    // dropping the socket: the whole OS process (and with it, the
    // in-memory presence Map) is gone.
    await killChild(child);
    child = spawnServer(port, mongod.getUri());
    await waitForHealth(port, child);

    // (a) Durable data survived the restart — verified against the real
    // mongod, not a mock.
    const historyRes = await fetch(
      `http://localhost:${port}/api/conversations/${conversationId}/messages`,
      { headers: { Cookie: a.authCookie } }
    );
    const history = await historyRes.json();
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]._id).toBe(persistedMessageId);

    // (b) Presence starts fully empty in the new process — not something
    // that needs a special reset step, since a freshly spawned process
    // cannot inherit another process's in-memory Map at all. What's
    // actually worth verifying at runtime is that the fresh presence
    // machinery still behaves correctly once clients reconnect: B
    // connects first (against the new process), then A reconnects with
    // its original, still-valid cookie (secrets/env are unchanged across
    // the restart, exactly as a real redeploy wouldn't rotate secrets),
    // and B — who has no stale knowledge of A — receives a genuine
    // `presence:online` for A.
    const socketB = connectSocket(port, b.authCookie);
    await waitForConnect(socketB);

    const presenceOnline = new Promise((resolve) => socketB.once('presence:online', resolve));
    const socketA2 = connectSocket(port, a.authCookie);
    await waitForConnect(socketA2);
    const presenceEvent = await presenceOnline;
    expect(presenceEvent.userId).toBe(a.user._id);

    // (c) The reconnecting client retries its pre-crash send with the
    // *same* clientMessageId (the realistic case: A's client never
    // received the ack before the process died and can't tell "the
    // server never got it" from "it got it but the ack was lost").
    // Exactly one document must exist afterward — the real-restart
    // counterpart to the in-process idempotency tests in
    // socket.messageSend.test.js.
    const retryAck = await emitAck(socketA2, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'sent before the crash',
    });
    expect(retryAck.ok).toBe(true);
    expect(retryAck.message._id).toBe(persistedMessageId);

    const finalHistoryRes = await fetch(
      `http://localhost:${port}/api/conversations/${conversationId}/messages`,
      { headers: { Cookie: a.authCookie } }
    );
    const finalHistory = await finalHistoryRes.json();
    expect(finalHistory.messages).toHaveLength(1);

    socketA2.close();
    socketB.close();
  }, 45000);
});
