import { useEffect, useState } from 'react';

// FRONTEND.md §14 — read receipts key off the Page Visibility API
// specifically, not window focus/blur: a visible-but-inactive window (e.g.
// alt-tabbed to another app with the chat still on screen) still counts as
// "could be reading this," while a backgrounded/minimized tab does not.
export function useDocumentVisibility() {
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    function handleChange() {
      setIsVisible(document.visibilityState === 'visible');
    }
    document.addEventListener('visibilitychange', handleChange);
    return () => document.removeEventListener('visibilitychange', handleChange);
  }, []);

  return isVisible;
}
