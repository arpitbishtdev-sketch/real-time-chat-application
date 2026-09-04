import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../src/api/conversations.api.js', () => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
}));

import { MessageList } from '../src/components/chat/MessageList.jsx';
import { getMessages } from '../src/api/conversations.api.js';
import { renderWithProviders } from './testUtils.jsx';

afterEach(cleanup);

// Each page is newest-first, matching BACKEND.md §12's { createdAt: -1 }
// sort — page 1 (the "older" page, fetched via "load older") holds
// strictly older messages than page 0.
const PAGE_1 = {
  messages: [
    { _id: 'm4', conversationId: 'c1', senderId: 'u1', text: 'four', status: 'sent', createdAt: '2026-01-10T00:04:00Z' },
    { _id: 'm3', conversationId: 'c1', senderId: 'u1', text: 'three', status: 'sent', createdAt: '2026-01-10T00:03:00Z' },
  ],
  nextCursor: 'cursor-to-page-2',
  nextAfter: null,
};

const PAGE_2 = {
  messages: [
    { _id: 'm2', conversationId: 'c1', senderId: 'u2', text: 'two', status: 'sent', createdAt: '2026-01-10T00:02:00Z' },
    { _id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'one', status: 'sent', createdAt: '2026-01-10T00:01:00Z' },
  ],
  nextCursor: null,
  nextAfter: null,
};

describe('MessageList', () => {
  beforeEach(() => {
    getMessages.mockReset();
  });

  it('shows a loading skeleton before history resolves', () => {
    getMessages.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<MessageList conversationId="c1" />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders an empty state for a conversation with no messages', async () => {
    getMessages.mockResolvedValue({ messages: [], nextCursor: null, nextAfter: null });
    renderWithProviders(<MessageList conversationId="c1" />);

    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  it('renders the first page oldest-message-first, and hides "load older" once nextCursor is null', async () => {
    getMessages.mockResolvedValue(PAGE_2);
    renderWithProviders(<MessageList conversationId="c1" />);

    expect(await screen.findByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();
  });

  it('loads the next page on "load older" and shows both pages without duplicates', async () => {
    getMessages.mockResolvedValueOnce(PAGE_1).mockResolvedValueOnce(PAGE_2);
    renderWithProviders(<MessageList conversationId="c1" />);

    expect(await screen.findByText('three')).toBeInTheDocument();
    expect(screen.getByText('four')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load older/i }));

    await waitFor(() => expect(screen.getByText('one')).toBeInTheDocument());
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('three')).toBeInTheDocument();
    expect(screen.getByText('four')).toBeInTheDocument();

    // Exactly four bubbles — no duplicate render of the first page.
    const container = screen.getByText('four').closest('.flex-1');
    expect(within(container).getAllByText(/^(one|two|three|four)$/)).toHaveLength(4);

    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages).toHaveBeenNthCalledWith(2, 'c1', { cursor: 'cursor-to-page-2' });
  });

  it('shows a retry affordance on failure', async () => {
    getMessages.mockRejectedValue(new Error('network error'));
    renderWithProviders(<MessageList conversationId="c1" />);

    expect(await screen.findByText("Couldn't load messages")).toBeInTheDocument();
  });
});
