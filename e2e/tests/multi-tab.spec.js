import { test, expect } from '@playwright/test';
import { registerViaUi, startConversationWith, openConversationWith, sendMessage } from '../support/actions.mjs';
import { registerUserViaApi, uniqueEmail } from '../support/apiHelpers.mjs';

// TESTING.md #17 (multiple browser tabs) / PROJECT_SPEC.md M17 task 6 — two
// pages sharing the SAME authenticated browser context (one cookie jar, two
// independent sockets — mirrors PROJECT_SPEC.md §12's "presence is per-user,
// multiple tabs collapse to one state" at the UI layer): a message sent in
// one tab must appear in the other with no duplicate render.
test('a message sent in one tab appears live in another tab of the same user, with no duplicate', async ({
  context,
}) => {
  const other = await registerUserViaApi({ displayName: 'Carol Tabs', email: uniqueEmail('carol-tabs') });

  const tab1 = await context.newPage();
  await registerViaUi(tab1, {
    displayName: 'Dave Tabs',
    email: uniqueEmail('dave-tabs'),
    password: 'correct-horse-battery',
  });
  await startConversationWith(tab1, other.user.displayName);

  const tab2 = await context.newPage();
  await tab2.goto('/');
  await openConversationWith(tab2, other.user.displayName);

  await sendMessage(tab1, 'sent from tab one');

  const tab1Log = tab1.getByRole('log');
  const tab2Log = tab2.getByRole('log');

  await expect(tab1Log.getByText('sent from tab one')).toBeVisible();
  await expect(tab2Log.getByText('sent from tab one')).toBeVisible();

  // No duplicate on the sending tab itself — the optimistic entry must be
  // reconciled with the ack/broadcast, never rendered as two bubbles
  // (FRONTEND.md §10, REALTIME.md §12a).
  await expect(tab1Log.getByText('sent from tab one')).toHaveCount(1);
  await expect(tab2Log.getByText('sent from tab one')).toHaveCount(1);
});
