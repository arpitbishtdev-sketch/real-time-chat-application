import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/api/users.api.js', () => ({
  getMe: vi.fn(),
}));

import App from '../src/App.jsx';
import { getMe } from '../src/api/users.api.js';

// PROJECT_SPEC.md M11 task 9 — routing smoke tests: the protected-route
// redirect is the milestone's one explicit acceptance criterion, so it's
// the one behavior that must be proven, not just asserted in prose.
function renderAt(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('App routing', () => {
  beforeEach(() => {
    getMe.mockReset();
  });

  it('redirects an unauthenticated visitor away from a protected route to /login', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));

    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lets an authenticated visitor reach a protected route', async () => {
    getMe.mockResolvedValue({
      user: { _id: '1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
    });

    renderAt('/');

    expect(await screen.findByText('Select a conversation')).toBeInTheDocument();
  });

  it('renders the login page directly, independent of the auth check', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));

    renderAt('/login');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends an already-authenticated visitor away from /login to the app', async () => {
    getMe.mockResolvedValue({
      user: { _id: '1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
    });

    renderAt('/login');

    await waitFor(() => expect(screen.getByText('Select a conversation')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('renders a not-found page for an unknown route', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));

    renderAt('/this-route-does-not-exist');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});
