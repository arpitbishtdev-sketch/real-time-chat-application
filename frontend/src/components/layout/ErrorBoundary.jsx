import { Component } from 'react';

import { Button } from '../ui/Button.jsx';

// FRONTEND.md §12 — a last-resort catch for render-time exceptions, not a
// substitute for per-panel query error states (see queries/, M13+).
export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
          <p className="text-lg font-semibold text-ink">Something went wrong</p>
          <p className="max-w-sm text-sm text-ink-muted">
            Try reloading the page. If the problem continues, please check back later.
          </p>
          <Button className="mt-2" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
