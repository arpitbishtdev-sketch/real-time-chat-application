import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

vi.mock('../src/api/users.api.js', () => ({
  getMe: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../src/api/conversations.api.js', () => ({
  getConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
}));

import { NewConversationPanel } from '../src/components/conversation/NewConversationPanel.jsx';
import { searchUsers } from '../src/api/users.api.js';
import { createConversation } from '../src/api/conversations.api.js';

afterEach(cleanup);

const USER = { _id: 'u2', displayName: 'Grace Hopper', avatarUrl: null, statusText: 'Compiling' };

// Renders with a real destination route so a successful "start
// conversation" is verified by what actually appears after navigation,
// not just by inspecting the navigate() call.
function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<NewConversationPanel onClose={onClose} />} />
            <Route
              path="/conversations/:conversationId"
              element={<div>Conversation view</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  };
}

describe('NewConversationPanel', () => {
  beforeEach(() => {
    searchUsers.mockReset();
    createConversation.mockReset();
  });

  it('prompts to search before anything is typed', () => {
    renderPanel();
    expect(screen.getByText('Find someone to message')).toBeInTheDocument();
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it('debounces input and only searches once typing settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchUsers.mockResolvedValue({ users: [USER] });
    renderPanel();

    const input = screen.getByLabelText('Search people');
    fireEvent.change(input, { target: { value: 'g' } });
    fireEvent.change(input, { target: { value: 'gr' } });
    fireEvent.change(input, { target: { value: 'gra' } });

    await vi.advanceTimersByTimeAsync(299);
    expect(searchUsers).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => expect(searchUsers).toHaveBeenCalledTimes(1));
    expect(searchUsers).toHaveBeenCalledWith('gra');
    vi.useRealTimers();
  });

  it('shows a no-matches state when the search returns nothing', async () => {
    searchUsers.mockResolvedValue({ users: [] });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'nobody' } });

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('starts a conversation on selecting a result and navigates to it', async () => {
    searchUsers.mockResolvedValue({ users: [USER] });
    createConversation.mockResolvedValue({
      conversation: { _id: 'c1', otherParticipant: USER },
      created: true,
    });
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'grace' } });
    fireEvent.click(await screen.findByText('Grace Hopper'));

    expect(await screen.findByText('Conversation view')).toBeInTheDocument();
    expect(createConversation).toHaveBeenCalledWith('u2');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and stays put when starting the conversation fails', async () => {
    searchUsers.mockResolvedValue({ users: [USER] });
    createConversation.mockRejectedValue(new Error('Something went wrong.'));
    renderPanel();

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'grace' } });
    fireEvent.click(await screen.findByText('Grace Hopper'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  });
});
