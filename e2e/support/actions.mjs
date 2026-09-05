// Shared Playwright page-level actions/selectors, kept in one place so a
// future UI copy change (a button's aria-label, a field's label text) is a
// one-line fix here instead of a find-and-replace across every spec.
import { expect } from '@playwright/test';

export async function registerViaUi(page, { displayName, email, password }) {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Chat', { exact: true })).toBeVisible();
}

export async function loginViaUi(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Chat', { exact: true })).toBeVisible();
}

// PROJECT_SPEC.md M13 task 3 — search UI is debounced (300ms); waiting on
// the result button appearing already absorbs that delay via Playwright's
// auto-waiting locators, so no manual sleep is needed here.
// getByLabel('Message') is ambiguous: Playwright's default substring,
// case-insensitive match also matches the "Send message" button's
// aria-label. The textarea's own role ('textbox') is enough to disambiguate.
function messageInput(page) {
  return page.getByRole('textbox', { name: 'Message' });
}

export async function startConversationWith(page, displayName) {
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByLabel('Search people').fill(displayName);
  await page.getByRole('button', { name: new RegExp(displayName) }).click();
  await expect(messageInput(page)).toBeVisible();
}

export async function openConversationWith(page, displayName) {
  await page.getByRole('link', { name: new RegExp(displayName) }).click();
  await expect(messageInput(page)).toBeVisible();
}

export async function sendMessage(page, text) {
  const input = messageInput(page);
  await input.fill(text);
  await input.press('Enter');
}
