import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';

import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createUserRouter } from './routes/user.routes.js';
import { createConversationRouter } from './routes/conversation.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PROJECT_SPEC.md M18 task 1/5 — production static-asset serving strategy
// (DECISION/WHY/ALTERNATIVES/TRADEOFF in the new "Deployment" doc section):
// this backend process serves the frontend's built assets itself, so the
// whole app is one origin, one process, no separate static host/CDN and no
// CORS needed for the app's own frontend in production — consistent with
// PROJECT_SPEC.md's single-instance target. Never referenced outside
// isProduction, so a dev/test checkout with no `frontend/dist` build is
// unaffected.
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

export function createApp() {
  const app = express();

  // PROJECT_SPEC.md M18 task 3 ("HTTP/server configuration") — most
  // realistic single-instance deploy targets (Render, Railway, Fly.io,
  // Heroku, a managed load balancer) sit behind a reverse proxy that
  // terminates TLS and forwards the real client IP via X-Forwarded-For.
  // Without `trust proxy`, express-rate-limit (v7+) refuses to start
  // (it treats a present X-Forwarded-For with an unconfigured trust proxy
  // as a spoofing risk) and req.ip would resolve to the proxy's address for
  // every client, collapsing every user into one shared rate-limit bucket.
  // Not enabled in dev/test, where no such proxy exists.
  if (env.isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  if (env.nodeEnv !== 'test') {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  // Liveness: "is the process up and responding at all." Never touches the
  // database — a DB outage must not make an otherwise-healthy process look
  // dead to a process manager/orchestrator (which would restart it for no
  // reason the restart could fix).
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness: "is this instance able to actually serve requests right
  // now." Distinct from liveness per PROJECT_SPEC.md M18's acceptance
  // criteria — fails (503) while MongoDB is unreachable so a load
  // balancer/orchestrator can stop routing traffic here without killing
  // the process, then recovers automatically once the connection does
  // (TESTING.md #24, extended to the readiness check specifically).
  app.get('/api/health/ready', (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ok' : 'unavailable',
      db: dbReady ? 'connected' : 'disconnected',
    });
  });

  if (env.isProduction) {
    app.use(express.static(FRONTEND_DIST));
  }

  app.use('/api/auth', createAuthRouter());
  app.use('/api/users', createUserRouter());
  app.use('/api/conversations', createConversationRouter());

  if (env.isProduction) {
    // Any other GET request is a client-side (React Router) route, not a
    // missing resource — serving index.html lets a hard refresh or direct
    // link to e.g. /conversations/<id> work instead of 404ing, since the
    // router only takes over once that HTML has loaded and hydrated.
    // Never matches /api/... (excluded below), which still falls through
    // to the JSON 404 handler.
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  // No route matched: an unknown /api/* path always, and — outside
  // production, where this process serves no frontend of its own — any
  // other path too.
  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    });
  });

  app.use(errorHandler);

  return app;
}
