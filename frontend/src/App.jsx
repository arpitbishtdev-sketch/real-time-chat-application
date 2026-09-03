import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRouter } from './routes/AppRouter.jsx';
import { ErrorBoundary } from './components/layout/ErrorBoundary.jsx';
import { useAuthStore } from './store/authStore.js';

// One QueryClient for the app's lifetime (task 6). refetchOnWindowFocus is
// off by default here — reconnection-driven refetching (REALTIME.md §19)
// is a deliberate, targeted call from the socket layer in M14, not a blunt
// "any window focus" refetch.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const loadCurrentUser = useAuthStore((state) => state.loadCurrentUser);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
