// Direct-HTTP helpers for seeding state Playwright's UI flows don't need to
// drive through the browser themselves — e.g. TESTING.md §7 flow 1's
// "search for a second (seeded) user" only needs that second user to exist
// in the database, not to have been registered via a second browser
// session. Talks straight to the real backend the webServer config already
// started (backendServer.mjs), on the same fixed port.
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5000';

export function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function registerUserViaApi({ displayName, email, password = 'correct-horse-battery' }) {
  const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email, password }),
  });
  if (!res.ok) {
    throw new Error(`registerUserViaApi failed with ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return { user: body.user, email, password };
}
