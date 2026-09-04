import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { MessageInput } from '../src/components/chat/MessageInput.jsx';

afterEach(cleanup);

// PROJECT_SPEC.md M14 composer requirements — rendering, validation,
// keyboard interaction, disabled/loading behavior, accessible label.
describe('MessageInput', () => {
  it('renders an accessibly-labeled field with the send button disabled while empty', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);

    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('enables the send button once there is non-whitespace text', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('sends on Enter and clears the field', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByLabelText('Message');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hello');
    expect(input).toHaveValue('');
  });

  it('does not send on Shift+Enter (newline instead)', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByLabelText('Message');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send an empty or whitespace-only message', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByLabelText('Message');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables the field and button with a stated reason when disabled', () => {
    render(<MessageInput onSend={vi.fn()} disabled disabledReason="Reconnecting…" />);

    const input = screen.getByLabelText('Message');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });
});
