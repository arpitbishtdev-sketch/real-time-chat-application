import http from 'http';

import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';

async function start() {
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);

  // Socket.IO is attached to this same HTTP server starting in M4 —
  // no realtime wiring yet, per M1's "foundation only" scope.

  httpServer.listen(env.port, () => {
    console.log(`Backend listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
