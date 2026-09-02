import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';

let app;
let server;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
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

function join(socket, conversationId) {
  return emitAck(socket, 'conversation:join', { conversationId });
}

function waitForEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('typing:start / typing:stop (M7)', () => {
  beforeEach(async () => {
    server = await startTestServer();
    app = server.app;
  });

  it("typing:start broadcasts typing:update{isTyping:true} to the conversation room, excluding all of the typer's own sockets", async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const aTab1 = connectSocket(server.url, a.authCookie);
    const aTab2 = connectSocket(server.url, a.authCookie);
    const bSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(aTab1),
      waitForConnectOrError(aTab2),
      waitForConnectOrError(bSocket),
    ]);
    await Promise.all([
      join(aTab1, conversationId),
      join(aTab2, conversationId),
      join(bSocket, conversationId),
    ]);

    const aTab2Events = [];
    aTab2.on('typing:update', (e) => aTab2Events.push(e));
    const bEventPromise = waitForEvent(bSocket, 'typing:update');

    aTab1.emit('typing:start', { conversationId });

    const bEvent = await bEventPromise;
    expect(bEvent).toEqual({ conversationId, userId: a.user._id, isTyping: true });

    // Give a would-be (incorrect) delivery to A's other tab a moment to arrive.
    await delay(100);
    expect(aTab2Events).toHaveLength(0);

    aTab1.close();
    aTab2.close();
    bSocket.close();
  });

  it('typing:stop broadcasts typing:update{isTyping:false}', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const aSocket = connectSocket(server.url, a.authCookie);
    const bSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(aSocket), waitForConnectOrError(bSocket)]);
    await Promise.all([join(aSocket, conversationId), join(bSocket, conversationId)]);

    aSocket.emit('typing:start', { conversationId });
    await waitForEvent(bSocket, 'typing:update');

    const stopEventPromise = waitForEvent(bSocket, 'typing:update');
    aSocket.emit('typing:stop', { conversationId });

    const stopEvent = await stopEventPromise;
    expect(stopEvent).toEqual({ conversationId, userId: a.user._id, isTyping: false });

    aSocket.close();
    bSocket.close();
  });

  it('silently drops typing:start from a non-participant — no broadcast, no error event', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const eve = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);

    const bSocket = connectSocket(server.url, b.authCookie);
    const eveSocket = connectSocket(server.url, eve.authCookie);
    await Promise.all([waitForConnectOrError(bSocket), waitForConnectOrError(eveSocket)]);
    await join(bSocket, conversationId);

    const bEvents = [];
    bSocket.on('typing:update', (e) => bEvents.push(e));
    const eveErrors = [];
    eveSocket.on('error', (e) => eveErrors.push(e));

    eveSocket.emit('typing:start', { conversationId });
    await delay(100);

    expect(bEvents).toHaveLength(0);
    expect(eveErrors).toHaveLength(0);
    expect(eveSocket.connected).toBe(true);

    bSocket.close();
    eveSocket.close();
  });

  it('silently drops a malformed typing:start payload — no error event, no crash', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const aSocket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(aSocket);

    const errors = [];
    aSocket.on('error', (e) => errors.push(e));

    aSocket.emit('typing:start', { conversationId: 'not-an-id' });
    await delay(100);

    expect(errors).toHaveLength(0);
    expect(aSocket.connected).toBe(true);

    aSocket.close();
  });

  it('server-side TTL auto-expires typing (typing:update{isTyping:false}) if typing:stop never arrives (REALTIME.md §15)', async () => {
    await server.close();
    server = await startTestServer({ typingTtlMs: 150 });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const aSocket = connectSocket(server.url, a.authCookie);
    const bSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(aSocket), waitForConnectOrError(bSocket)]);
    await Promise.all([join(aSocket, conversationId), join(bSocket, conversationId)]);

    const events = [];
    bSocket.on('typing:update', (e) => events.push(e));

    aSocket.emit('typing:start', { conversationId });
    // No typing:stop ever sent.

    await delay(400);

    expect(events).toEqual([
      { conversationId, userId: a.user._id, isTyping: true },
      { conversationId, userId: a.user._id, isTyping: false },
    ]);

    aSocket.close();
    bSocket.close();
  });

  it('typing indicator disconnect: a typer that disconnects mid-type without typing:stop still expires via the TTL (TESTING.md #22)', async () => {
    await server.close();
    server = await startTestServer({ typingTtlMs: 150 });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const aSocket = connectSocket(server.url, a.authCookie);
    const bSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(aSocket), waitForConnectOrError(bSocket)]);
    await Promise.all([join(aSocket, conversationId), join(bSocket, conversationId)]);

    const expireEventPromise = waitForEvent(bSocket, 'typing:update');
    aSocket.emit('typing:start', { conversationId });
    await expireEventPromise;

    const ttlExpiryPromise = waitForEvent(bSocket, 'typing:update');
    aSocket.close();

    const expiry = await ttlExpiryPromise;
    expect(expiry).toEqual({ conversationId, userId: a.user._id, isTyping: false });

    bSocket.close();
  });
});
