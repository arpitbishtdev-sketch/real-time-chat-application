# Real-Time Chat Application

A standalone, from-scratch real-time chat app (MERN + Socket.IO) built to demonstrate interview-grade fundamentals in backend API design, real-time systems, data modeling, authentication/authorization, reliability engineering, and security engineering.

See `CLAUDE.md`, `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `BACKEND.md`, `FRONTEND.md`, `REALTIME.md`, and `TESTING.md` for the full design and milestone roadmap. This repository is through **M18 — Deployment, Logging & Observability** (CLAUDE.md §20 has the live milestone index).

## Prerequisites

- Node.js 20+
- A local MongoDB instance (default dev config expects `mongodb://127.0.0.1:27017`)

## Quick Start (development)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in real values — see below
npm run dev             # starts on http://localhost:5000
```

Required environment variables (`backend/.env`, see `.env.example`):

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | Backend HTTP port (default `5000`) |
| `MONGODB_URI` | MongoDB connection string |
| `CLIENT_ORIGIN` | Frontend origin allowed by CORS (default `http://localhost:5173` in development; **required, no default, in production** — see ARCHITECTURE.md §19) |
| `JWT_ACCESS_SECRET` | Signing secret for access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Signing secret for refresh tokens (min 32 chars) |

The server validates these on boot and exits with a clear error if any required variable is missing or invalid — it will not start in a half-configured state.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev   # starts on http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/socket.io` requests to the backend on port 5000, so the frontend can call the API without a separate CORS round trip in development.

## Verifying the setup

- Backend health check: `curl http://localhost:5000/api/health` → `{"status":"ok"}`
- Readiness (fails if MongoDB is unreachable): `curl http://localhost:5000/api/health/ready`
- Via the frontend proxy: `curl http://localhost:5173/api/health` → same response
- Frontend: visiting `http://localhost:5173` renders a blank page with no console errors

## Production

The backend serves the built frontend itself (single origin, single process) — see ARCHITECTURE.md §19 for the full deployment writeup (env vars, health checks, graceful shutdown, logging, and what's explicitly still missing for a real production deployment) and BACKEND.md §17 for the exact command sequence:

```bash
cd frontend && npm install && npm run build && cd ..
cd backend && npm install
NODE_ENV=production npm start   # requires a production .env — see ARCHITECTURE.md §19
```

Stop it with `SIGTERM`/`SIGINT` (Ctrl+C) for a graceful drain rather than killing it outright.

## Testing

Every layer has its own suite; a root-level command runs all three:

```bash
npm test              # backend (Vitest) -> frontend (Vitest) -> e2e (Playwright)
npm run test:backend
npm run test:frontend
npm run test:e2e       # spins up a real backend (ephemeral MongoDB) + real Vite dev server
npm run lint           # backend + frontend ESLint
```

See TESTING.md for the full testing strategy and the 33-case edge-case matrix.

## Scripts

Backend (`backend/`):
- `npm run dev` — start with auto-restart (nodemon)
- `npm start` — start once, no watch (this is what production runs)
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint
- `npm run format` — Prettier write

Frontend (`frontend/`):
- `npm run dev` — Vite dev server
- `npm run build` — production build (outputs `frontend/dist`, served by the backend in production)
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint
- `npm run format` — Prettier write

E2E (`e2e/`):
- `npm test` — run the Playwright suite (`npm run test:headed` to watch it run)

## Project Structure

Three independent npm packages (no monorepo/workspace tooling — kept simple deliberately, see `CLAUDE.md` §14a's interview-focus notes); the root `package.json` exists only to wire the single cross-package `npm test`/`npm run lint` commands above, not as a workspace root:

```
backend/   Express + MongoDB/Mongoose + Socket.IO (attached starting M4)
frontend/  React + Vite, Tailwind CSS, TanStack Query, Zustand, React Router
e2e/       Playwright — drives the real backend + real frontend as a black box
```

See `CLAUDE.md` §4 for the full folder layout contract the backend/frontend packages follow.
