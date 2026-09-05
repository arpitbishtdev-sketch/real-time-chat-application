import { test, expect } from '@playwright/test';
import { registerViaUi, startConversationWith, sendMessage } from '../support/actions.mjs';
import { registerUserViaApi, uniqueEmail } from '../support/apiHelpers.mjs';

// TESTING.md §7 flow 1 — the single-user golden path: register, log in
// (registration logs the user in immediately, BACKEND.md M2), search for a
// seeded second user, start a conversation, send a message, see it appear.
// This is the "are the layers actually wired together" smoke test —
// unit/integration/socket layers already cover each piece's correctness in
// isolation.
test('register, start a conversation with a seeded user, send a message, and see it appear', async ({ page }) => {
  const other = await registerUserViaApi({ displayName: 'Grace Hopper', email: uniqueEmail('grace') });

  await registerViaUi(page, {
    displayName: 'Ada Lovelace',
    email: uniqueEmail('ada'),
    password: 'correct-horse-battery',
  });

  await startConversationWith(page, other.user.displayName);
  await sendMessage(page, 'Hello from the E2E suite');

  // Renders both as the message bubble and (truncated) as the conversation
  // list's preview text (ConversationListItem) — .first() avoids a
  // strict-mode ambiguity between the two, not a narrowing of the check.
  await expect(page.getByText('Hello from the E2E suite').first()).toBeVisible();
});

test('a duplicate conversation start with the same user reopens the existing conversation, not a new one', async ({
  page,
}) => {
  const other = await registerUserViaApi({ displayName: 'Katherine Johnson', email: uniqueEmail('katherine') });

  await registerViaUi(page, {
    displayName: 'Margaret Hamilton',
    email: uniqueEmail('margaret'),
    password: 'correct-horse-battery',
  });

  await startConversationWith(page, other.user.displayName);
  await sendMessage(page, 'first message');
  await expect(page.getByText('first message').first()).toBeVisible();

  // PROJECT_SPEC.md §10 — conversation creation is idempotent by sorted
  // participant pair; starting "a new conversation" with the same person a
  // second time must land back in the same thread, with history intact,
  // never a second empty one. The conversation-list pane stays visible
  // alongside the chat pane at this (desktop) viewport size, so "New
  // conversation" is reachable without any back-navigation first.
  await startConversationWith(page, other.user.displayName);
  await expect(page.getByText('first message').first()).toBeVisible();
});
