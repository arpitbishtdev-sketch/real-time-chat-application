import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useUserSearch } from '../../queries/useUserSearch.js';
import { createConversation } from '../../api/conversations.api.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Input } from '../ui/Input.jsx';
import { Skeleton } from '../ui/Skeleton.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';

// PROJECT_SPEC.md M13 tasks 2/3 — debounced user search plus the
// "start conversation" flow. `POST /conversations` is idempotent
// server-side (returns the existing conversation with 200 rather than
// creating a duplicate), so this never needs its own "does a conversation
// already exist" check — it just calls the endpoint and navigates to
// whatever conversation comes back.
export function NewConversationPanel({ onClose }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data, isLoading, isError } = useUserSearch(debouncedQuery);
  const [startError, setStartError] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSelect(user) {
    setStartError(null);
    setStartingId(user._id);
    try {
      const { conversation } = await createConversation(user._id);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/conversations/${conversation._id}`);
      onClose();
    } catch (err) {
      setStartError(err.message ?? 'Could not start the conversation. Please try again.');
      setStartingId(null);
    }
  }

  const results = data?.users ?? [];
  const trimmed = debouncedQuery.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-3">
        <Input
          label="Search people"
          placeholder="Search by name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this
          // panel is itself the user's intent to search; focus follows.
          autoFocus
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {startError && (
          <p role="alert" className="px-4 py-2 text-sm text-danger">
            {startError}
          </p>
        )}
        {!trimmed && (
          <EmptyState title="Find someone to message" description="Start typing a name to search." />
        )}
        {trimmed && isLoading && (
          <div className="flex flex-col gap-3 px-4 py-3">
            <span role="status" className="sr-only">
              Searching…
            </span>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}
        {trimmed && isError && (
          <EmptyState title="Search failed" description="Something went wrong. Try again." />
        )}
        {trimmed && !isLoading && !isError && results.length === 0 && (
          <EmptyState title="No matches" description={`No one found for "${trimmed}".`} />
        )}
        {trimmed && !isLoading && !isError && results.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {results.map((user) => (
              <li key={user._id}>
                <button
                  type="button"
                  onClick={() => handleSelect(user)}
                  disabled={startingId === user._id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Avatar name={user.displayName} src={user.avatarUrl} size="md" decorative />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{user.displayName}</p>
                    {user.statusText && (
                      <p className="truncate text-sm text-ink-muted">{user.statusText}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
