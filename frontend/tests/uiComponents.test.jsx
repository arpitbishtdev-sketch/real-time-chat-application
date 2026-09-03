import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Input } from '../src/components/ui/Input.jsx';
import { Button } from '../src/components/ui/Button.jsx';

// Base component set (M11 task 4) — testing the accessibility contracts
// that matter (label association, error announcement, loading/disabled
// state), not a snapshot of rendered markup.
describe('Input', () => {
  it('associates the label and an error message so both are screen-reader reachable', () => {
    render(<Input label="Email" error="Email is required" />);

    const input = screen.getByLabelText('Email');
    const error = screen.getByRole('alert');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(error).toHaveTextContent('Email is required');
  });
});

describe('Button', () => {
  it('disables itself and marks aria-busy while loading, without losing its label', () => {
    render(<Button loading>Send</Button>);

    const button = screen.getByRole('button', { name: /send/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('defaults to type="button" so it never accidentally submits a surrounding form', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByRole('button', { name: 'Click me' })).toHaveAttribute('type', 'button');
  });
});
