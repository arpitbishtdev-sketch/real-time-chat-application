import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';

vi.mock('../src/api/conversations.api.js', () => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
}));

import { ChatPage } from '../src/pages/ChatPage.jsx';
import { getConversations, getMessages } from '../src/api/conversations.api.js';
import { renderWithProviders } from './testUtils.jsx';

afterEach(cleanup);

// FRONTEND.md §18 — single-pane-with-back-navigation on mobile is driven
// by conditionally applying Tailwind's `hidden` utility to whichever pane
// isn't active; sm: and up shows both regardless. jsdom doesn't compute
// real layout, so this asserts on the class itself rather than visual
// visibility.
describe('ChatPage responsive layout', () => {
  beforeEach(() => {
    getConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    getMessages.mockResolvedValue({ messages: [], nextCursor: null, nextAfter: null });
  });

  it('shows the conversation list pane and hides the chat pane with no conversation selected', async () => {
    renderWithProviders(<ChatPage />, { route: '/', path: '/' });

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
    const aside = document.querySelector('aside');
    const section = document.querySelector('section');
    expect(aside).not.toHaveClass('hidden');
    expect(section).toHaveClass('hidden');
  });

  it('shows the chat pane and hides the conversation list pane with a conversation selected', async () => {
    renderWithProviders(<ChatPage />, {
      route: '/conversations/c1',
      path: '/conversations/:conversationId',
    });

    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    const aside = document.querySelector('aside');
    const section = document.querySelector('section');
    expect(aside).toHaveClass('hidden');
    expect(section).not.toHaveClass('hidden');
  });
});
