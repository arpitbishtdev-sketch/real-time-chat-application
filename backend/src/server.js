import http from 'http';

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';

// PROJECT_SPEC.md M18 task 7 — an uncaught exception or unhandled rejection
// means the process reached a state its own code never anticipated;
// continuing to serve traffic from possibly-corrupted in-memory state (the
// presence map, the join/leave intent map, the per-conversation
// send-ordering chain — all process-local per ARCHITECTURE.md §17) is worse
// than a fast, loud failure a process manager can restart cleanly from.
// Deliberately an immediate exit, not the graceful shutdown() below: that
// path assumes the process is healthy and just asked to stop; this one
// doesn't get to assume that.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — exiting:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection — exiting:', reason);
  process.exit(1);
});

async function start() {
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer, { clientOrigin: env.clientOrigin });

  // Lets REST controllers reach the live Socket.IO instance — currently
  // only auth.service.js's logoutAllSessions (BACKEND.md §6a), which was
  // a documented no-op until this registration existed.
  app.set('io', io);

  httpServer.listen(env.port, () => {
    console.log(`Backend listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Graceful shutdown (PROJECT_SPEC.md M18 task 3) — SIGTERM is how a
  // process manager/container orchestrator asks for a clean stop before
  // escalating to SIGKILL; SIGINT is the same signal Ctrl+C sends locally.
  // Order mirrors tests/helpers/testServer.js's own close() (disconnect
  // sockets -> close io -> close the HTTP server, both calls needed since
  // Socket.IO doesn't take ownership of an externally-created httpServer's
  // shutdown), with MongoDB disconnected last so any request already past
  // its DB call can still finish during the drain.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down gracefully…`);

    try {
      io.disconnectSockets(true);
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
      await disconnectDB();
      console.log('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
