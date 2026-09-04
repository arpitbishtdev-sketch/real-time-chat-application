import { useQuery } from '@tanstack/react-query';

import { searchUsers } from '../api/users.api.js';

// PROJECT_SPEC.md M13 task 2 — the caller debounces `query` before it
// reaches this hook (see useDebouncedValue); this hook just skips the
// request entirely for an empty query rather than searching for "".
export function useUserSearch(query) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['userSearch', trimmed],
    queryFn: () => searchUsers(trimmed),
    enabled: trimmed.length > 0,
  });
}
