import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// PROJECT_SPEC.md M18 — "production-safe defaults." config/env.js's
// validation runs (and can process.exit(1)) as a side effect of import, so
// it can only be exercised realistically as a separate child process, the
// same technique tests/integration/server.restart.test.js already uses for
// module-load-time/process-level behavior.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const envJsUrl = pathToFileURL(path.join(backendRoot, 'src/config/env.js')).href;

function importEnv(overrides) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-e', `import('${envJsUrl}').then(() => process.stdout.write('ENV_OK'))`],
      {
        // A real developer checkout has a git-ignored backend/.env for
        // local dev (this repo's own included) — dotenv.config() would
        // load it and fill in CLIENT_ORIGIN regardless of what's passed
        // below, defeating every case in this file. Running from a
        // directory with no .env (and importing env.js by absolute file://
        // URL, since cwd is no longer backendRoot) sidesteps that entirely
        // — closer to a real deployment anyway, where no .env file ships.
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          MONGODB_URI: 'mongodb://127.0.0.1:27017/env-config-test',
          JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
          JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
          // Never inherit a real developer's CLIENT_ORIGIN — every case
          // here sets it explicitly (or explicitly omits it).
          CLIENT_ORIGIN: undefined,
          ...overrides,
        },
      }
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => resolve({ code, output }));
  });
}

describe('env config — production-safe CLIENT_ORIGIN (PROJECT_SPEC.md M18)', () => {
  it('refuses to boot in production with CLIENT_ORIGIN unset, rather than silently falling back to the dev default', async () => {
    const { code, output } = await importEnv({ NODE_ENV: 'production', CLIENT_ORIGIN: undefined });

    expect(code).not.toBe(0);
    expect(output).toContain('CLIENT_ORIGIN');
    expect(output).not.toContain('ENV_OK');
  });

  it('boots normally in production once CLIENT_ORIGIN is explicitly set', async () => {
    const { code, output } = await importEnv({
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://chat.example.com',
    });

    expect(code).toBe(0);
    expect(output).toContain('ENV_OK');
  });

  it('still boots in development with no CLIENT_ORIGIN set, using the dev-convenience default (unchanged behavior)', async () => {
    const { code, output } = await importEnv({ NODE_ENV: 'development', CLIENT_ORIGIN: undefined });

    expect(code).toBe(0);
    expect(output).toContain('ENV_OK');
  });
});
