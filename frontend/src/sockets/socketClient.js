import { io } from 'socket.io-client';

// FRONTEND.md §9 — a single module-level socket.io-client instance, not
// re-created per component. `autoConnect: false` because connection is
// driven reactively by authStore.status (useSocketConnection), not by
// module import order. No explicit URL: the client always talks to its
// own origin, which vite.config.js's dev proxy (and, in production, the
// same static-serving origin) forwards to the backend — mirroring
// api/client.js's relative-path convention, so there's no separate
// "socket base URL" to configure per environment.
export const socket = io({
  autoConnect: false,
  withCredentials: true,
});

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket() {
  socket.disconnect();
}

// message:send is acked (REALTIME.md §11) — `.timeout()` (socket.io-client
// v4) turns "no ack within N ms" (including a mid-flight disconnect that
// never resolves the ack) into a rejected promise, which is exactly the
// "no ack before disconnect" case PROJECT_SPEC.md M14 task 7 asks the
// composer to treat as retryable rather than hanging forever.
const SEND_ACK_TIMEOUT_MS = 8000;

export function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(SEND_ACK_TIMEOUT_MS).emit('message:send', payload, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

// conversation:join / conversation:leave (REALTIME.md §7/§11). Join
// resolves with the ack `{ok, error?}` so the caller can surface a
// FORBIDDEN/CONVERSATION_NOT_FOUND response; leave has no ack (server
// treats a malformed payload as a scoped `error` event instead, and a
// well-formed leave for a room never joined is defined as a safe no-op).
export function joinConversation(conversationId) {
  return new Promise((resolve) => {
    socket.emit('conversation:join', { conversationId }, (response) => {
      resolve(response ?? { ok: false, error: { code: 'INTERNAL_ERROR', message: 'No response.' } });
    });
  });
}

// Guarded by `socket.connected`: a dropped connection has already lost
// every room membership server-side (REALTIME.md §18), so there's nothing
// to leave, and emitting anyway would just sit in the send buffer and fire
// as a stray leave right as the next connection's join is going out.
export function leaveConversation(conversationId) {
  if (!socket.connected) return;
  socket.emit('conversation:leave', { conversationId });
}
