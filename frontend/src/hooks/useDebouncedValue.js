import { useEffect, useState } from 'react';

// PROJECT_SPEC.md M13 task 2 — debounces the user-search input so it
// doesn't fire a request per keystroke.
export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
