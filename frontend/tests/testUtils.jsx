import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render } from '@testing-library/react';

// A fresh QueryClient per render avoids the cross-test cache leakage a
// module-level singleton (like App.jsx's) would cause — each test gets a
// clean cache rather than possibly-stale data from a previous test's
// query of the same key.
export function renderWithProviders(ui, { route = '/', path = '/' } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}
