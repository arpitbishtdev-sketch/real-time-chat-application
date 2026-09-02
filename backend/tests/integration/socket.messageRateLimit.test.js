import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { Message } from '../../src/models/Message.js';

let app;
let server;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);

afterEach(async () => {
  await server.close();
});

async function createConversation(a, b) {
  const res = await request(app)
    .post('/api/conversations')
    .set('Cookie', [a.authCookie])
    .send({ participantId: b.user._id });
  return res.body.conversation._id;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function send(socket, conversationId, text = 'hi') {
  return emitAck(socket, 'message:send', { conversationId, clientMessageId: randomUUID(), text });
}

// PROJECT_SPEC.md M10 task 4 / REALTIME.md §25 / TESTING.md #16 — the
// documented token bucket for message:send, actually wired up in this
// milestone. `messageRateLimit` is a test-only override so these tests
// don't have to wait out the real 20-capacity/2-per-sec production window.
describe('message:send rate limiting (M10, REALTIME.md §25, TESTING.md #16)', () => {
  it('rejects sends beyond capacity with RATE_LIMITED while staying within capacity succeeds, and never disconnects the socket', async () => {
    server = await startTestServer({ messageRateLimit: { capacity: 3, refillPerSecond: 0 } });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await send(socket, conversationId, `msg-${i}`));
    }

    expect(results.slice(0, 3).every((r) => r.ok === true)).toBe(true);
    expect(results.slice(3)).toEqual([
      { ok: false, error: { code: 'RATE_LIMITED', message: expect.any(String) } },
      { ok: false, error: { code: 'RATE_LIMITED', message: expect.any(String) } },
    ]);

    expect(await Message.countDocuments({ conversationId })).toBe(3);
    expect(socket.connected).toBe(true);

    socket.close();
  });

  it('refills over time and allows sends again once the window passes (reset/window behavior)', async () => {
    server = await startTestServer({ messageRateLimit: { capacity: 2, refillPerSecond: 20 } });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const first = await send(socket, conversationId, 'one');
    const second = await send(socket, conversationId, 'two');
    const third = await send(socket, conversationId, 'three');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });

    // At 20 tokens/sec, waiting 150ms refills at least one token.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const afterRefill = await send(socket, conversationId, 'four');
    expect(afterRefill.ok).toBe(true);

    socket.close();
  });

  it('gives each user an independent budget — one user being limited never blocks another', async () => {
    server = await startTestServer({ messageRateLimit: { capacity: 1, refillPerSecond: 0 } });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    const socketB = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketA), waitForConnectOrError(socketB)]);

    const aFirst = await send(socketA, conversationId, 'from A #1');
    const aSecond = await send(socketA, conversationId, 'from A #2');
    expect(aFirst.ok).toBe(true);
    expect(aSecond.ok).toBe(false);

    // B has never sent — B's own budget is untouched by A's usage.
    const bFirst = await send(socketB, conversationId, 'from B #1');
    expect(bFirst.ok).toBe(true);

    socketA.close();
    socketB.close();
  });

  it('checks the limit before payload validation, so malformed-payload spam is bounded exactly like valid sends', async () => {
    server = await startTestServer({ messageRateLimit: { capacity: 2, refillPerSecond: 0 } });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    // Two malformed payloads exhaust the budget just like valid ones would.
    const malformed1 = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: '',
    });
    const malformed2 = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: '',
    });
    expect(malformed1.error.code).toBe('VALIDATION_ERROR');
    expect(malformed2.error.code).toBe('VALIDATION_ERROR');

    // A third attempt — this time with an otherwise perfectly valid
    // payload — is rejected as RATE_LIMITED, not VALIDATION_ERROR, proving
    // the rate-limit check runs first and malformed attempts already used
    // up the budget.
    const thirdAttempt = await send(socket, conversationId, 'would have been valid');
    expect(thirdAttempt).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
    expect(await Message.countDocuments({ conversationId })).toBe(0);

    socket.close();
  });

  it('does not share state with unrelated events — a user rate-limited on message:send can still join rooms, mark delivered/read, and type', async () => {
    server = await startTestServer({ messageRateLimit: { capacity: 1, refillPerSecond: 0 } });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    const socketB = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketA), waitForConnectOrError(socketB)]);
    await emitAck(socketB, 'conversation:join', { conversationId });

    const sentAck = await send(socketA, conversationId, 'only one allowed');
    expect(sentAck.ok).toBe(true);
    const exhaustedAck = await send(socketA, conversationId, 'blocked');
    expect(exhaustedAck.ok).toBe(false);
    expect(exhaustedAck.error.code).toBe('RATE_LIMITED');

    // A's message:send bucket is empty, but every other event A can emit
    // is untouched by it — a rate limiter scoped to one event must never
    // leak into unrelated ones.
    const joinAck = await emitAck(socketA, 'conversation:join', { conversationId });
    expect(joinAck.ok).toBe(true);

    const readAck = await emitAck(socketA, 'message:read', {
      conversationId,
      upToMessageId: sentAck.message._id,
    });
    expect(readAck.ok).toBe(true);

    const typingReceived = new Promise((resolve) => socketB.once('typing:update', resolve));
    socketA.emit('typing:start', { conversationId });
    const typingEvent = await typingReceived;
    expect(typingEvent).toMatchObject({ conversationId, userId: a.user._id, isTyping: true });

    socketA.close();
    socketB.close();
  });
});
