import { test, expect } from '@playwright/test';
import { registerViaUi, loginViaUi, startConversationWith, openConversationWith, sendMessage } from '../support/actions.mjs';
import { registerUserViaApi, uniqueEmail } from '../support/apiHelpers.mjs';

// TESTING.md §7 flow 2 — two independent browser contexts (simulating two
// separate users/devices, each with their own cookie jar), verifying live
// delivery and the read-receipt loop closes correctly end-to-end: something
// only an E2E test can check, since the socket-level tests (M5/M8) mock
// neither side's actual client-side listener wiring.
test('a message sent by one user appears live for the other, and progresses to delivered/read', async ({
  browser,
}) => {
  const bob = await registerUserViaApi({ displayName: 'Bob Bell', email: uniqueEmail('bob') });

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await registerViaUi(pageA, {
      displayName: 'Alice Ames',
      email: uniqueEmail('alice'),
      password: 'correct-horse-battery',
    });
    await startConversationWith(pageA, bob.user.displayName);

    // Bob logs in only after the conversation exists, so his first
    // GET /conversations already includes it (PROJECT_SPEC.md §10 —
    // conversations aren't created lazily by search, only by starting one).
    await loginViaUi(pageB, { email: bob.email, password: bob.password });
    await openConversationWith(pageB, 'Alice Ames');

    await sendMessage(pageA, 'live delivery check');

    // Live receipt on Bob's side (message:new), with no page refresh.
    // Scoped to the message log (role="log") since the same text also
    // legitimately appears a second time as the conversation list's own
    // preview text, which would otherwise make this locator ambiguous.
    await expect(pageB.getByRole('log').getByText('live delivery check')).toBeVisible();

    // Closing the loop from Bob's client: message:delivered fires on
    // receipt (M15 task 3), then message:read fires because Bob's tab is
    // the active, visible conversation (useReadReceipts) — both surface on
    // Alice's side as her sent bubble's status icon (FRONTEND.md §17).
    const statusIcon = pageA.getByRole('img', { name: 'Read' });
    await expect(statusIcon).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
