import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ConnectionBanner } from '../src/components/layout/ConnectionBanner.jsx';
import { useSocketStore } from '../src/store/socketStore.js';

afterEach(cleanup);

// FRONTEND.md §13 — connection-status indicator: hidden while connected,
// visible for every other state in the socket state machine.
describe('ConnectionBanner', () => {
  it('renders nothing while connected', () => {
    useSocketStore.setState({ status: 'connected' });
    render(<ConnectionBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a reconnecting message while the socket is reconnecting', () => {
    useSocketStore.setState({ status: 'reconnecting' });
    render(<ConnectionBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });

  it('shows a disconnected message when not auto-retrying', () => {
    useSocketStore.setState({ status: 'disconnected' });
    render(<ConnectionBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(/disconnected/i);
  });
});
