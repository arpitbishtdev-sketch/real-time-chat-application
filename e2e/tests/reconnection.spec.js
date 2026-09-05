import { test, expect } from '@playwright/test';
import { registerViaUi, loginViaUi, startConversationWith, openConversationWith, sendMessage } from '../support/actions.mjs';
import { registerUserViaApi, uniqueEmail } from '../support/apiHelpers.mjs';

// TESTING.md §7 flow 3 / edge cases #5 (network interruption) and #6
// (reconnection) — kill the network on one context mid-session, restore it,
// and confirm both the UI's own reconnecting state (FRONTEND.md §13) and
// the missed-message resync (REALTIME.md §19, exercised at the unit level
// in useSocketConnection.test.jsx, here proven end-to-end against a real
// socket transport) recover correctly with no duplicate/lost messages.
test('recovers a message sent while offline, with the reconnecting UI shown and no duplicates', async ({
  browser,
}) => {
  // Socket.IO's default pingInterval/pingTimeout (25s/20s, unconfigured —
  // backend/src/sockets/index.js only overrides them if explicitly passed)
  // means a client whose transport doesn't get a prompt close event from
  // Chrome's offline emulation can take up to ~45s to notice the drop via
  // the heartbeat alone — generous timeouts below reflect that worst case
  // rather than the common (much faster) case, per "avoid brittle
  // timing-based assertions."
  test.setTimeout(120_000);

  const bob = await registerUserViaApi({ displayName: 'Bob Reconnect', email: uniqueEmail('bob-recon') });

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await registerViaUi(pageA, {
      displayName: 'Alice Reconnect',
      email: uniqueEmail('alice-recon'),
      password: 'correct-horse-battery',
    });
    await startConversationWith(pageA, bob.user.displayName);
    await sendMessage(pageA, 'seen before disconnect');

    await loginViaUi(pageB, { email: bob.email, password: bob.password });
    await openConversationWith(pageB, 'Alice Reconnect');
    await expect(pageB.getByRole('log').getByText('seen before disconnect')).toBeVisible();

    // Kill Bob's network mid-session.
    await contextB.setOffline(true);
    await expect(pageB.getByRole('status').filter({ hasText: /Reconnecting|Disconnected/ })).toBeVisible({
      timeout: 50_000,
    });

    // Alice sends while Bob is genuinely offline — this is the "missed"
    // message Bob's reconnect must sync, not receive live.
    await sendMessage(pageA, 'sent while bob was offline');
    await expect(pageA.getByText('sent while bob was offline').first()).toBeVisible();

    // Restore the network; Socket.IO's client auto-reconnects (no page
    // reload), which should trigger the resync.
    await contextB.setOffline(false);
    const messageLog = pageB.getByRole('log');
    await expect(messageLog.getByText('sent while bob was offline')).toBeVisible({ timeout: 30_000 });

    // No duplicate render of the message reconnection just synced — scoped
    // to the message log itself, since the same text also legitimately
    // appears a second time as the conversation list's preview text.
    await expect(messageLog.getByText('sent while bob was offline')).toHaveCount(1);
    // The banner clears once genuinely reconnected.
    await expect(pageB.getByRole('status').filter({ hasText: /Reconnecting|Disconnected/ })).toHaveCount(0, {
      timeout: 15_000,
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
