import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { User } from '../../src/models/User.js';

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

function waitForEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

// Polls rather than trusting a fixed delay — mirrors socket.disconnect.test.js's
// own waitUntilRemoved() pattern for the same underlying async cleanup.
function waitUntil(check) {
  return vi.waitFor(() => {
    if (!check()) {
      throw new Error('condition not yet true');
    }
  });
}

describe('Presence (M7)', () => {
  beforeEach(async () => {
    server = await startTestServer();
    app = server.app;
  });

  it("broadcasts presence:online to a shared-conversation contact when a user's first socket connects", async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    const onlineEvent = waitForEvent(socketA, 'presence:online');
    const socketB = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB);

    const event = await onlineEvent;
    expect(event).toEqual({ userId: b.user._id });

    socketA.close();
    socketB.close();
  });

  it('does not re-broadcast presence:online for a second socket (tab) from an already-online user', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    const events = [];
    socketA.on('presence:online', (e) => events.push(e));

    const socketB1 = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB1);
    await waitUntil(() => events.length === 1);

    const socketB2 = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB2);
    // Give the (absent) second broadcast a moment to arrive if the bug existed.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events).toEqual([{ userId: b.user._id }]);

    socketA.close();
    socketB1.close();
    socketB2.close();
  });

  it('a user with two open tabs still shows online (no presence:offline, no lastSeenAt) after closing one', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    const offlineEvents = [];
    socketA.on('presence:offline', (e) => offlineEvents.push(e));

    const socketB1 = connectSocket(server.url, b.authCookie);
    const socketB2 = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketB1), waitForConnectOrError(socketB2)]);
    expect(server.io.userSockets.get(b.user._id)?.size).toBe(2);

    const closedSocketId = socketB1.id;
    socketB1.close();
    await waitUntil(() => !server.io.userSockets.get(b.user._id)?.has(closedSocketId));

    // Still online: the map still has the second socket, no offline event,
    // and lastSeenAt is not set on the User document.
    expect(server.io.userSockets.get(b.user._id)?.size).toBe(1);
    expect(offlineEvents).toHaveLength(0);
    const bDoc = await User.findById(b.user._id);
    expect(bDoc.lastSeenAt).toBeFalsy();

    socketA.close();
    socketB2.close();
  });

  it("sets lastSeenAt and broadcasts presence:offline only when the user's last socket disconnects (TESTING.md #4)", async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    const socketB = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB);

    const offlineEvent = waitForEvent(socketA, 'presence:offline');
    socketB.close();

    const event = await offlineEvent;
    expect(event.userId).toBe(b.user._id);
    expect(typeof event.lastSeenAt).toBe('string');
    expect(server.io.userSockets.has(b.user._id)).toBe(false);

    const bDoc = await User.findById(b.user._id);
    expect(bDoc.lastSeenAt).toBeInstanceOf(Date);

    socketA.close();
  });

  it('clears lastSeenAt and re-broadcasts presence:online on reconnect after having gone offline', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    const socketB1 = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB1);

    const offlineEvent = waitForEvent(socketA, 'presence:offline');
    socketB1.close();
    await offlineEvent;

    let bDoc = await User.findById(b.user._id);
    expect(bDoc.lastSeenAt).toBeInstanceOf(Date);

    const onlineEvent = waitForEvent(socketA, 'presence:online');
    const socketB2 = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB2);
    await onlineEvent;

    bDoc = await User.findById(b.user._id);
    expect(bDoc.lastSeenAt).toBeFalsy();

    socketA.close();
    socketB2.close();
  });

  it('scopes presence broadcasts to shared-conversation contacts only — a non-contact never receives them', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const stranger = await registerUser(app, { displayName: 'Stranger' });
    // Note: no conversation created between `a`/`b` and `stranger`.
    await createConversation(a, b);

    const strangerSocket = connectSocket(server.url, stranger.authCookie);
    await waitForConnectOrError(strangerSocket);

    const events = [];
    strangerSocket.on('presence:online', (e) => events.push(e));
    strangerSocket.on('presence:offline', (e) => events.push(e));

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);
    socketA.close();
    await waitUntil(() => !server.io.userSockets.has(a.user._id));

    // Give any (incorrect) broadcast a moment to arrive.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toHaveLength(0);

    strangerSocket.close();
  });

  it('a socket that drops abruptly (no close frame) is still detected via ping-timeout and flips presence to offline (TESTING.md #23)', async () => {
    await server.close();
    server = await startTestServer({ pingInterval: 300, pingTimeout: 200 });
    app = server.app;

    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socketA);

    // Force an immediate websocket connection so the raw transport socket
    // is available to kill directly, bypassing any Engine.IO close frame.
    const socketB = connectSocket(server.url, b.authCookie, { transports: ['websocket'] });
    await waitForConnectOrError(socketB);

    const offlineEvent = waitForEvent(socketA, 'presence:offline');

    // Destroy the underlying TCP/WebSocket connection with no close
    // handshake — a real "network cut," not socket.close()/socket.io.engine.close(),
    // which both send a clean close signal the server would act on immediately.
    socketB.io.engine.transport.ws.terminate();

    const event = await offlineEvent;
    expect(event.userId).toBe(b.user._id);
    expect(server.io.userSockets.has(b.user._id)).toBe(false);

    const bDoc = await User.findById(b.user._id);
    expect(bDoc.lastSeenAt).toBeInstanceOf(Date);

    socketA.close();
  }, 10000);
});
