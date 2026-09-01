import http from 'http';
import { io as ioClient } from 'socket.io-client';

import { createApp } from '../../src/app.js';
import { createSocketServer } from '../../src/sockets/index.js';

// Boots a real HTTP server + real Socket.IO server on an ephemeral port,
// mirroring server.js's wiring (including app.set('io', io), the exact
// seam auth.service.js's logoutAllSessions already expects) — per
// TESTING.md §5, socket behavior is tested against a real running server,
// never a mocked transport.
export async function startTestServer() {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer, { clientOrigin: 'http://localhost:5173' });
  app.set('io', io);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();

  return {
    app,
    io,
    port,
    url: `http://localhost:${port}`,
    async close() {
      io.disconnectSockets(true);
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

// Connects a socket.io-client using the same `accessToken=...` cookie
// string shape testUsers.js's registerUser() already returns — no second
// credential format invented for sockets.
export function connectSocket(url, authCookie) {
  return ioClient(url, {
    extraHeaders: authCookie ? { Cookie: authCookie } : {},
    reconnection: false,
    forceNew: true,
  });
}

// Resolves once the socket either connects or the handshake is rejected,
// so a test never has to hand-roll the same connect/connect_error race.
export function waitForConnectOrError(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });
}
