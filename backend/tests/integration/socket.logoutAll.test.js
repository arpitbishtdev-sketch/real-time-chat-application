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

beforeEach(async () => {
  server = await startTestServer();
  app = server.app;
});

afterEach(async () => {
  await server.close();
});

function waitForDisconnect(socket) {
  return new Promise((resolve) => socket.once('disconnect', resolve));
}

describe('POST /auth/logout-all — live socket disconnection (closes the M2-deferred loop)', () => {
  // auth.service.js's logoutAllSessions(userId, io) has called
  // io.in(`user:<id>`).disconnectSockets() since M2, but `io` was always
  // undefined until this milestone registers it via app.set('io', io) —
  // this is the first test able to exercise that real effect end-to-end.
  it('disconnects a live socket for the user immediately when logout-all is called', async () => {
    const { authCookie } = await registerUser(app, { displayName: 'Ada' });

    const socket = connectSocket(server.url, authCookie);
    await waitForConnectOrError(socket);

    const disconnected = waitForDisconnect(socket);
    const res = await request(app).post('/api/auth/logout-all').set('Cookie', [authCookie]);
    expect(res.status).toBe(200);

    await disconnected;
    expect(socket.connected).toBe(false);
  });

  it("does not disconnect another user's live socket", async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });

    const socketA = connectSocket(server.url, a.authCookie);
    const socketB = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketA), waitForConnectOrError(socketB)]);

    const disconnectedA = waitForDisconnect(socketA);
    await request(app).post('/api/auth/logout-all').set('Cookie', [a.authCookie]);
    await disconnectedA;

    // Give socketB a moment to prove it was never touched.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socketB.connected).toBe(true);

    socketB.close();
  });
});
