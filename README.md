# Real-Time Chat Application

A standalone, from-scratch real-time chat app (MERN + Socket.IO) built to demonstrate interview-grade fundamentals in backend API design, real-time systems, data modeling, authentication/authorization, reliability engineering, and security engineering.

See `CLAUDE.md`, `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `BACKEND.md`, `FRONTEND.md`, `REALTIME.md`, and `TESTING.md` for the full design and milestone roadmap. This repository is currently at **M1 — Repository Setup & MERN Foundation**: a runnable backend/frontend skeleton with no feature logic yet.

## Prerequisites

- Node.js 20+
- A local MongoDB instance (default dev config expects `mongodb://127.0.0.1:27017`)

## Quick Start

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
| `CLIENT_ORIGIN` | Frontend origin allowed by CORS (default `http://localhost:5173`) |
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
- Via the frontend proxy: `curl http://localhost:5173/api/health` → same response
- Frontend: visiting `http://localhost:5173` renders a blank page with no console errors

## Scripts

Backend (`backend/`):
- `npm run dev` — start with auto-restart (nodemon)
- `npm start` — start once, no watch
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint
- `npm run format` — Prettier write

Frontend (`frontend/`):
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint
- `npm run format` — Prettier write

## Project Structure

Two independent npm packages (no monorepo/workspace tooling — kept simple deliberately, see `CLAUDE.md` §14a's interview-focus notes):

```
backend/   Express + MongoDB/Mongoose + Socket.IO (attached starting M4)
frontend/  React + Vite, Tailwind CSS, TanStack Query, Zustand, React Router
```

See `CLAUDE.md` §4 for the full folder layout contract both packages follow.
