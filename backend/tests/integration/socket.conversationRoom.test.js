import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

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

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe('conversation:join / conversation:leave', () => {
  it('lets a participant join their conversation room, ack ok:true, and adds the socket to the room', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'conversation:join', { conversationId });
    expect(ack).toEqual({ ok: true });

    const room = server.io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
    expect(room).toBeDefined();
    expect(room.has(socket.id)).toBe(true);

    socket.close();
  });

  it('rejects a non-participant with ack {ok:false, FORBIDDEN} and never adds them to the room (no broadcast leak)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const c = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);

    const outsiderSocket = connectSocket(server.url, c.authCookie);
    await waitForConnectOrError(outsiderSocket);

    const ack = await emitAck(outsiderSocket, 'conversation:join', { conversationId });
    expect(ack).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });

    const room = server.io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
    expect(room?.has(outsiderSocket.id)).toBeFalsy();

    // Confirm no leak: a real participant's broadcast never reaches the outsider.
    const receivedProbe = [];
    outsiderSocket.on('probe:event', (msg) => receivedProbe.push(msg));
    server.io.to(`conversation:${conversationId}`).emit('probe:event', { hello: 'world' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receivedProbe).toHaveLength(0);

    outsiderSocket.close();
  });

  it('returns CONVERSATION_NOT_FOUND for a well-formed but nonexistent conversation id', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const fakeId = new mongoose.Types.ObjectId().toString();
    const ack = await emitAck(socket, 'conversation:join', { conversationId: fakeId });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'CONVERSATION_NOT_FOUND', message: expect.any(String) },
    });

    socket.close();
  });

  it('returns VALIDATION_ERROR for a malformed conversation id', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'conversation:join', { conversationId: 'not-an-id' });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });

    socket.close();
  });

  it('ignores a client-supplied userId alongside conversationId — authorization always uses the authenticated socket.userId', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const c = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);

    // Eve connects as herself but tries to claim she's user A in the payload.
    const socket = connectSocket(server.url, c.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'conversation:join', {
      conversationId,
      userId: a.user._id,
    });
    expect(ack).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });

    socket.close();
  });

  it('re-joining an already-joined room is idempotent (ok:true again, no error)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    await emitAck(socket, 'conversation:join', { conversationId });
    const secondAck = await emitAck(socket, 'conversation:join', { conversationId });
    expect(secondAck).toEqual({ ok: true });

    socket.close();
  });

  it('lets a participant leave a joined room, removing the socket from it', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);
    await emitAck(socket, 'conversation:join', { conversationId });

    socket.emit('conversation:leave', { conversationId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const room = server.io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
    expect(room?.has(socket.id)).toBeFalsy();

    socket.close();
  });

  it('leaving a room the socket was never in is a safe no-op', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const fakeId = new mongoose.Types.ObjectId().toString();
    const errors = [];
    socket.on('error', (e) => errors.push(e));

    socket.emit('conversation:leave', { conversationId: fakeId });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors).toHaveLength(0);
    expect(socket.connected).toBe(true);

    socket.close();
  });

  it('emits a scoped error event for a malformed conversation:leave payload, without disconnecting', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const errorPromise = new Promise((resolve) => socket.once('error', resolve));
    socket.emit('conversation:leave', { conversationId: 'not-an-id' });

    const err = await errorPromise;
    expect(err).toEqual({ code: 'VALIDATION_ERROR', message: expect.any(String) });
    expect(socket.connected).toBe(true);

    socket.close();
  });
});
