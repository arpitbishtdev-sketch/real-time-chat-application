import http from 'http';

import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';

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
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
