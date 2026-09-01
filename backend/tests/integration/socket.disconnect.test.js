import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';

let app;
let server;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);

beforeEach(async () => {
  server = await startTestServer();
  app = server.app;
});

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

// Polls server-side state rather than trusting the client's own
// 'disconnect' event as a proxy — the client fires that once it notices
// the closure, which isn't guaranteed ordered with the server finishing
// its own cleanup for the same event.
function waitUntilRemoved(userSockets, userId, socketId) {
  return vi.waitFor(() => {
    if (userSockets.get(userId)?.has(socketId)) {
      throw new Error('socket still present');
    }
  });
}

describe('Socket disconnect cleanup', () => {
  it('removes the socket from the user->socket map on disconnect', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);
    // socket.id (client-side) resets to undefined the instant close() is
    // called — capture it first, since every check below runs afterward.
    const socketId = socket.id;

    expect(server.io.userSockets.get(a.user._id)?.has(socketId)).toBe(true);

    socket.close();
    await waitUntilRemoved(server.io.userSockets, a.user._id, socketId);

    expect(server.io.userSockets.has(a.user._id)).toBe(false);
  });

  it('clears the socket join/leave intent-map entries on disconnect', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);
    const socketId = socket.id;

    await new Promise((resolve) => {
      socket.emit('conversation:join', { conversationId }, resolve);
    });

    const key = `${socketId}:${conversationId}`;
    expect(server.io.conversationIntents.get(key)).toBe('join');

    socket.close();
    await waitUntilRemoved(server.io.userSockets, a.user._id, socketId);

    expect(server.io.conversationIntents.has(key)).toBe(false);
  });

  it('does not affect other users left connected when one disconnects', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });

    const socketA = connectSocket(server.url, a.authCookie);
    const socketB = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketA), waitForConnectOrError(socketB)]);
    const socketAId = socketA.id;
    const socketBId = socketB.id;

    socketA.close();
    await waitUntilRemoved(server.io.userSockets, a.user._id, socketAId);

    expect(server.io.userSockets.has(a.user._id)).toBe(false);
    expect(server.io.userSockets.get(b.user._id)?.has(socketBId)).toBe(true);

    socketB.close();
  });

  it('supports two sockets for the same user (multi-device/tab) both landing in user:<id>', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });

    const socket1 = connectSocket(server.url, a.authCookie);
    const socket2 = connectSocket(server.url, a.authCookie);
    await Promise.all([waitForConnectOrError(socket1), waitForConnectOrError(socket2)]);

    const room = server.io.sockets.adapter.rooms.get(`user:${a.user._id}`);
    expect(room?.has(socket1.id)).toBe(true);
    expect(room?.has(socket2.id)).toBe(true);
    expect(server.io.userSockets.get(a.user._id)?.size).toBe(2);

    socket1.close();
    socket2.close();
  });

  it('handles an abrupt disconnect (no close frame) the same way as a graceful one', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);
    const socketId = socket.id;

    // Simulate an abrupt drop: destroy the underlying engine.io transport
    // rather than calling the client's graceful close().
    socket.io.engine.close();
    await waitUntilRemoved(server.io.userSockets, a.user._id, socketId);

    expect(server.io.userSockets.has(a.user._id)).toBe(false);
  });
});
