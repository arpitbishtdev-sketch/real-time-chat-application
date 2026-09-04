import { useEffect, useRef } from 'react';

import { emitTypingStart, emitTypingStop } from '../sockets/socketClient.js';

// FRONTEND.md §16 — "on first keystroke after idle" + "after a debounce
// window of no input, or on submit/blur," never left to expire only via
// the server-side TTL (REALTIME.md §15 is the backstop for a client that
// disconnects mid-type, not the primary stop signal).
const IDLE_MS = 2000;

export function useTypingEmitter(conversationId) {
  const isTypingRef = useRef(false);
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function stop() {
    clearTimer();
    if (isTypingRef.current) {
      isTypingRef.current = false;
      emitTypingStop(conversationId);
    }
  }

  function notifyTyping() {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emitTypingStart(conversationId);
    }
    clearTimer();
    timerRef.current = setTimeout(stop, IDLE_MS);
  }

  // Conversation switch or unmount: stop immediately rather than leaving a
  // stray typing:start for a conversation this tab is no longer looking at
  // to rely solely on the server TTL (PROJECT_SPEC.md M15 "no
  // cross-conversation leakage"). `stop` closes over the conversationId
  // from the render this effect belongs to, so the cleanup always targets
  // the conversation being left, not whatever is active by the time it runs.
  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return { notifyTyping, notifyStopped: stop };
}
