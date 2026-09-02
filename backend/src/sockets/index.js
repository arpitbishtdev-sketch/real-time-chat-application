import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';

import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/tokens.js';
import {
  createIntentMap,
  registerConversationHandlers,
  clearSocketIntents,
} from './conversation.handlers.js';
import { createMessageChains, registerMessageHandlers } from './message.handlers.js';
import { createPresenceMap, handleSocketConnected, handleSocketDisconnected } from './presence.js';
import { createTypingState, registerTypingHandlers } from './typing.handlers.js';
import { createMessageRateLimiter } from './rateLimit.js';

// Handshake auth middleware — runs once per connection attempt, before any
// event handler is registered (REALTIME.md §5). Reuses the exact same
// verifyAccessToken() the REST authenticate middleware calls; no second
// auth system, no DB round trip (stateless, same tradeoff as REST).
function socketAuthMiddleware(socket, next) {
  const cookieHeader = socket.handshake.headers.cookie;
  const cookies = cookieHeader ? parseCookie(cookieHeader) : {};
  const token = cookies.accessToken;

  if (!token) {
    const err = new Error('Authentication required.');
    err.data = { code: 'NO_TOKEN' };
    return next(err);
  }

  try {
    const decoded = verifyAccessToken(token);
    socket.userId = decoded.sub;
    return next();
  } catch {
    // Invalid signature or expired — collapsed into one code, mirroring
    // authenticate.js's REST behavior exactly.
    const err = new Error('Invalid or expired access token.');
    err.data = { code: 'INVALID_TOKEN' };
    return next(err);
  }
}

// Attaches a Socket.IO server to an existing http.Server (same port, same
// process — ARCHITECTURE.md §7). Each call gets its own presence/intent
// maps rather than module-level singletons, so multiple instances (e.g.
// one per test) never leak state into each other.
//
// `pingInterval`/`pingTimeout`, `typingTtlMs`, and `messageRateLimit` are
// optional overrides — omitted in production (server.js), so Socket.IO's
// own heartbeat defaults and REALTIME.md §25's documented capacity/refill
// apply there (REALTIME.md §8's "stale presence" detection relies on
// exactly that built-in mechanism, task 8). Tests pass short/small values
// so the abrupt-disconnect, typing-TTL, and rate-limit cases don't have to
// wait out the real production windows.
export function createSocketServer(
  httpServer,
  { clientOrigin, pingInterval, pingTimeout, typingTtlMs, messageRateLimit } = {}
) {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
    ...(pingInterval !== undefined ? { pingInterval } : {}),
    ...(pingTimeout !== undefined ? { pingTimeout } : {}),
  });

  const presenceMap = createPresenceMap();
  const intentMap = createIntentMap();
  const messageChains = createMessageChains();
  const typingState = createTypingState();
  const messageRateLimiter = createMessageRateLimiter(messageRateLimit);

  // Same map M4 introduced — kept as `io.userSockets` for compatibility
  // with M4's existing tests/behavior; M7 only adds the presence-handling
  // logic (sockets/presence.js) around it.
  io.userSockets = presenceMap;
  // Exposed for tests to deterministically observe the join/leave "latest
  // intent wins" race guard (REALTIME.md §7) instead of guessing timeouts.
  io.conversationIntents = intentMap;
  // Exposed for tests to await in-flight sends before asserting DB state
  // (BACKEND.md §13c's per-conversation ordering chain).
  io.messageChains = messageChains;
  // Exposed for tests to inspect/await typing TTL timers directly instead
  // of guessing waits.
  io.typingTimers = typingState;
  // Exposed for tests to inspect/reset bucket state directly instead of
  // waiting out the real refill window (REALTIME.md §25).
  io.messageRateLimiter = messageRateLimiter;

  io.use(socketAuthMiddleware);

  const logLifecycle = env.nodeEnv !== 'test';

  io.on('connection', (socket) => {
    if (logLifecycle) {
      console.log(`Socket connected: ${socket.id} (user ${socket.userId})`);
    }

    handleSocketConnected(io, presenceMap, socket.userId, socket.id).catch((err) => {
      console.error('Failed to process socket connect presence update:', err);
    });
    socket.join(`user:${socket.userId}`);

    registerConversationHandlers(socket, intentMap);
    registerMessageHandlers(socket, io, messageChains, messageRateLimiter);
    registerTypingHandlers(socket, io, typingState, typingTtlMs);

    socket.on('disconnect', (reason) => {
      if (logLifecycle) {
        console.log(`Socket disconnected: ${socket.id} (user ${socket.userId}, ${reason})`);
      }
      handleSocketDisconnected(io, presenceMap, socket.userId, socket.id).catch((err) => {
        console.error('Failed to process socket disconnect presence update:', err);
      });
      clearSocketIntents(intentMap, socket.id);
    });
  });

  return io;
}
