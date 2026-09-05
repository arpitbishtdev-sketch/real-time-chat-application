// Boots a real backend (real Express + Socket.IO + a real, ephemeral
// MongoDB instance via mongodb-memory-server) as the actual OS process
// Playwright's `webServer` config manages — not a mock, per TESTING.md §7
// ("a real running backend + real MongoDB (test instance)"). This script IS
// the process Playwright starts/stops; it spawns `backend/src/server.js` as
// its own child so mongod's lifetime and the app server's lifetime are both
// torn down together when Playwright kills this process's tree at the end
// of the run.
//
// Fixed port (5000) rather than an ephemeral one because frontend/vite.config.js's
// dev-server proxy target is hardcoded to http://localhost:5000 (mirrored by
// e2e/playwright.config.js's frontend webServer, which runs the same `vite`
// dev server, not a production build) — see TESTING.md's "E2E harness"
// section for why this reuses the existing dev proxy instead of introducing
// a separate production-style static-serving path this project doesn't have
// yet (that's M18's concern).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../../backend');

const PORT = process.env.E2E_BACKEND_PORT ?? '5000';
const CLIENT_ORIGIN = process.env.E2E_CLIENT_ORIGIN ?? 'http://localhost:5174';

async function main() {
  const mongod = await MongoMemoryServer.create();

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT,
      MONGODB_URI: mongod.getUri(),
      CLIENT_ORIGIN,
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: 'inherit',
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill();
    await mongod.stop();
    process.exit(0);
  }

  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`backend server exited early with code ${code}`);
      mongod.stop().finally(() => process.exit(code ?? 1));
    }
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start E2E backend:', err);
  process.exit(1);
});
