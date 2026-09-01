import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

import { env } from '../../src/config/env.js';
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

describe('Socket.IO handshake authentication', () => {
  it('accepts a connection with a valid accessToken cookie', async () => {
    const { authCookie } = await registerUser(app);
    const socket = connectSocket(server.url, authCookie);

    await expect(waitForConnectOrError(socket)).resolves.toBe(socket);
    expect(socket.connected).toBe(true);

    socket.close();
  });

  it('sets socket.userId server-side from the verified token, never from client input', async () => {
    const { user, authCookie } = await registerUser(app);
    const socket = connectSocket(server.url, authCookie);
    await waitForConnectOrError(socket);

    // The socket must already be a member of its own user:<id> room —
    // observable server-side via the io instance's room adapter.
    const room = server.io.sockets.adapter.rooms.get(`user:${user._id}`);
    expect(room).toBeDefined();
    expect(room.has(socket.id)).toBe(true);

    socket.close();
  });

  it('rejects a connection with no cookie at all', async () => {
    const socket = connectSocket(server.url, null);

    await expect(waitForConnectOrError(socket)).rejects.toMatchObject({
      data: { code: 'NO_TOKEN' },
    });

    socket.close();
  });

  it('rejects a connection with a malformed token', async () => {
    const socket = connectSocket(server.url, 'accessToken=not-a-real-jwt');

    await expect(waitForConnectOrError(socket)).rejects.toMatchObject({
      data: { code: 'INVALID_TOKEN' },
    });

    socket.close();
  });

  it('rejects a connection with an expired token', async () => {
    const { user } = await registerUser(app);
    const expired = jwt.sign(
      { sub: String(user._id), exp: Math.floor(Date.now() / 1000) - 10 },
      env.jwt.accessSecret
    );
    const socket = connectSocket(server.url, `accessToken=${expired}`);

    await expect(waitForConnectOrError(socket)).rejects.toMatchObject({
      data: { code: 'INVALID_TOKEN' },
    });

    socket.close();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'someone' }, 'a-completely-different-secret-value-1234', {
      expiresIn: '15m',
    });
    const socket = connectSocket(server.url, `accessToken=${forged}`);

    await expect(waitForConnectOrError(socket)).rejects.toMatchObject({
      data: { code: 'INVALID_TOKEN' },
    });

    socket.close();
  });

  it('still connects successfully even after the underlying Session document is deleted (stateless handshake, documented tradeoff)', async () => {
    // BACKEND.md §6a / REALTIME.md §5: handshake verification is fully
    // stateless — no DB round trip, no Session lookup. Deleting sessions
    // doesn't affect an already-issued access token's validity.
    const { Session } = await import('../../src/models/Session.js');
    const { authCookie } = await registerUser(app);
    await Session.deleteMany({});

    const socket = connectSocket(server.url, authCookie);
    await expect(waitForConnectOrError(socket)).resolves.toBe(socket);

    socket.close();
  });
});
