import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../src/api/users.api.js', () => ({
  getMe: vi.fn(),
}));

vi.mock('../src/api/auth.api.js', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));

import { ApiError } from '../src/api/client.js';
import App from '../src/App.jsx';
import { useAuthStore } from '../src/store/authStore.js';
import { getMe } from '../src/api/users.api.js';
import { login, register, logout } from '../src/api/auth.api.js';

// PROJECT_SPEC.md M12 — the full register/login/logout flow, driven through
// the real App tree (routes, guards, store) rather than the pages in
// isolation, since the acceptance criteria are about the flow end to end.
function renderAt(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

const AUTHENTICATED_USER = { _id: '1', displayName: 'Ada Lovelace', email: 'ada@example.com' };

afterEach(cleanup);

// authStore is a module-level singleton — without this, whichever test
// last authenticated (or logged out) leaks its status/user into the next
// test's initial render, since only the DOM (via `cleanup`) resets
// automatically between tests, not the store.
beforeEach(() => {
  useAuthStore.setState({ user: null, status: 'idle' });
});

describe('Login', () => {
  beforeEach(() => {
    getMe.mockReset();
    login.mockReset();
    register.mockReset();
    logout.mockReset();
  });

  it('logs a returning user in and lands them on the authenticated shell', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));
    login.mockResolvedValue({ user: AUTHENTICATED_USER });

    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Select a conversation')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct-horse' });
  });

  it('shows a form-level error for invalid credentials and keeps the user on the page', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));
    login.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'));

    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('blocks submission and shows field errors when required fields are empty', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));

    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows a busy submit button while the request is in flight', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));
    let resolveLogin;
    login.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    resolveLogin({ user: AUTHENTICATED_USER });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument());
  });
});

describe('Registration', () => {
  beforeEach(() => {
    getMe.mockReset();
    login.mockReset();
    register.mockReset();
    logout.mockReset();
  });

  it('registers a new user and lands them on the authenticated shell', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));
    register.mockResolvedValue({ user: AUTHENTICATED_USER });

    renderAt('/register');
    await screen.findByRole('heading', { name: 'Create your account' });

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Select a conversation')).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
    });
  });

  it('shows a duplicate-email error on the email field, not a generic form error', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));
    register.mockRejectedValue(
      new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.')
    );

    renderAt('/register');
    await screen.findByRole('heading', { name: 'Create your account' });

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const emailInput = await screen.findByLabelText('Email');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('An account with this email already exists.')).toBeInTheDocument();
    // Exactly one alert (the field-level error) — no separate generic
    // form-level banner duplicating the same failure.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('blocks submission and shows field errors for a too-short password', async () => {
    getMe.mockRejectedValue(new Error('not authenticated'));

    renderAt('/register');
    await screen.findByRole('heading', { name: 'Create your account' });

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});

describe('Logout', () => {
  beforeEach(() => {
    getMe.mockReset();
    login.mockReset();
    register.mockReset();
    logout.mockReset();
  });

  it('clears the session and returns the user to the login screen', async () => {
    getMe.mockResolvedValue({ user: AUTHENTICATED_USER });
    logout.mockResolvedValue({ ok: true });

    renderAt('/');
    await screen.findByText('Select a conversation');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(logout).toHaveBeenCalled();
  });

  it('still clears local session state when the logout request itself fails', async () => {
    getMe.mockResolvedValue({ user: AUTHENTICATED_USER });
    logout.mockRejectedValue(new Error('network error'));

    renderAt('/');
    await screen.findByText('Select a conversation');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
