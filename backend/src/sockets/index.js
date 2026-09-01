import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';

import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/tokens.js';
import {
  createIntentMap,
  registerConversationHandlers,
  clearSocketIntents,
} from './conversation.handlers.js';

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

function addUserSocket(userSockets, userId, socketId) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);
}

function removeUserSocket(userSockets, userId, socketId) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(userId);
  }
}

// Attaches a Socket.IO server to an existing http.Server (same port, same
// process — ARCHITECTURE.md §7). Each call gets its own userSockets/intent
// maps rather than module-level singletons, so multiple instances (e.g.
// one per test) never leak state into each other.
export function createSocketServer(httpServer, { clientOrigin } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
  });

  const userSockets = new Map(); // userId -> Set<socketId>, foundation for M7 presence
  const intentMap = createIntentMap();

  // Exposed for tests and for future milestones (M7 presence reads this
  // same map rather than a second one) — not used for any broadcast yet.
  io.userSockets = userSockets;
  // Exposed for tests to deterministically observe the join/leave "latest
  // intent wins" race guard (REALTIME.md §7) instead of guessing timeouts.
  io.conversationIntents = intentMap;

  io.use(socketAuthMiddleware);

  const logLifecycle = env.nodeEnv !== 'test';

  io.on('connection', (socket) => {
    if (logLifecycle) {
      console.log(`Socket connected: ${socket.id} (user ${socket.userId})`);
    }

    addUserSocket(userSockets, socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);

    registerConversationHandlers(socket, intentMap);

    socket.on('disconnect', (reason) => {
      if (logLifecycle) {
        console.log(`Socket disconnected: ${socket.id} (user ${socket.userId}, ${reason})`);
      }
      removeUserSocket(userSockets, socket.userId, socket.id);
      clearSocketIntents(intentMap, socket.id);
    });
  });

  return io;
}
