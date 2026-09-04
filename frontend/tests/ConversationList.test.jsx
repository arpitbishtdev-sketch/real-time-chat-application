import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../src/api/conversations.api.js', () => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
}));

import { ConversationList } from '../src/components/conversation/ConversationList.jsx';
import { getConversations } from '../src/api/conversations.api.js';
import { renderWithProviders } from './testUtils.jsx';

afterEach(cleanup);

const CONVERSATION = {
  _id: 'c1',
  otherParticipant: { _id: 'u2', displayName: 'Grace Hopper', avatarUrl: null },
  lastMessageAt: '2026-01-10T11:45:00Z',
  lastMessagePreview: 'See you tomorrow',
  unreadCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ConversationList', () => {
  beforeEach(() => {
    getConversations.mockReset();
  });

  it('shows a loading skeleton before the request resolves', () => {
    getConversations.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ConversationList />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders each conversation with its preview and unread badge', async () => {
    getConversations.mockResolvedValue({ conversations: [CONVERSATION], nextCursor: null });
    renderWithProviders(<ConversationList />);

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('See you tomorrow')).toBeInTheDocument();
    expect(screen.getByLabelText('3 unread')).toHaveTextContent('3');
  });

  it('shows an empty state when there are no conversations', async () => {
    getConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    renderWithProviders(<ConversationList />);

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });

  it('shows a retry affordance on failure and refetches on click', async () => {
    getConversations.mockRejectedValueOnce(new Error('network error'));
    getConversations.mockResolvedValueOnce({ conversations: [CONVERSATION], nextCursor: null });
    renderWithProviders(<ConversationList />);

    expect(await screen.findByText("Couldn't load conversations")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    await waitFor(() => expect(getConversations).toHaveBeenCalledTimes(2));
  });
});
