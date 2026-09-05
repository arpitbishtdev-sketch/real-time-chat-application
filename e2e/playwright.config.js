import { defineConfig, devices } from '@playwright/test';

// TESTING.md §7 — E2E is a small number of high-value flows against a real
// running backend + real MongoDB (test instance), checking that the layers
// below are actually wired together correctly, not a replacement for them.
// Single browser project (Chromium) rather than a cross-browser matrix —
// this project's E2E goal is verifying app wiring/reliability behavior, not
// cross-browser rendering fidelity, so the tradeoff favors a faster,
// deterministic run over broader (and here, low-value) browser coverage.
const BACKEND_PORT = 5000;
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Every spec shares one backend process + one in-memory MongoDB instance
  // (see support/backendServer.mjs) — parallel workers would mean parallel
  // specs racing the same database, which is exactly the kind of
  // non-deterministic cross-test interference TESTING.md's "keep tests
  // deterministic" principle rules out. Each spec still gets its own
  // uniquely-emailed users, so specs never collide with each other's data
  // even though they run in the same process sequentially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Playwright starts both, waits for each to become healthy, and tears
  // down the whole process tree (backend wrapper -> mongod + server.js
  // child, and the Vite dev server) when the run ends.
  webServer: [
    {
      command: 'node support/backendServer.mjs',
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        E2E_BACKEND_PORT: String(BACKEND_PORT),
        E2E_CLIENT_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
      },
    },
    {
      // The real dev server (not a production build/preview) so
      // vite.config.js's existing `/api` + `/socket.io` proxy (already
      // hardcoded to target http://localhost:5000, matching BACKEND_PORT
      // above) needs no changes for E2E — see backendServer.mjs's header
      // comment for why a production static-serving path isn't used here.
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: '../frontend',
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
