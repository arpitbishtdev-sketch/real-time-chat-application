# CLAUDE.md — Project Instructions for Claude Code

> **Read this file, and the other six root docs (`PROJECT_SPEC.md`, `ARCHITECTURE.md`, `BACKEND.md`, `FRONTEND.md`, `REALTIME.md`, `TESTING.md`), before modifying this project.** These documents are the source of truth. If code and docs disagree, treat that as a bug — fix the code or update the doc explicitly, never silently drift.

## 1. Project Purpose

A standalone, from-scratch Real-Time Chat Application (MERN + Socket.IO). It exists to demonstrate **interview-grade** fundamentals in:

- Backend API design (Express, REST)
- Real-time systems (Socket.IO, WebSockets)
- Data modeling and query design (MongoDB/Mongoose)
- Authentication & authorization (JWT, cookies)
- Reliability engineering (reconnection, offline sync, idempotency, ordering)
- Security engineering (input validation, rate limiting, XSS-safe rendering)

This is **not** a tutorial clone and **not** a feature race. Depth, correctness, and the ability to explain every decision out loud in an interview matter more than breadth of features.

## 2. Engineering Philosophy

- **Correctness over cleverness.** Simple, explicit code beats a clever abstraction nobody can defend under questioning.
- **Design for failure.** Every feature must have an answer to "what happens when this fails halfway through?"
- **REST persists, Socket.IO delivers.** MongoDB is the single source of truth. Socket.IO is a delivery mechanism for real-time events, never a data store of record.
- **Never trust the client.** `userId`, `conversationId`, `roomId`, and any authorization claim arriving from the client is untrusted input until re-verified server-side against the authenticated session.
- **No speculative infrastructure.** No Redis, no message queues, no microservices, no Kubernetes, no Kafka, unless explicitly requested. Document how the system *could* scale; don't build for a scale that doesn't exist yet.
- **Everything must be explainable.** If a future Claude session (or the human) can't explain *why* a line of code exists, it shouldn't exist yet.

## 3. Technology Choices (locked — see `ARCHITECTURE.md` for rationale)

| Concern | Choice | Alternative considered |
|---|---|---|
| Frontend | React + Vite | Next.js (rejected — SSR adds no value for an authenticated SPA chat app) |
| Backend | Node.js + Express | Fastify (rejected — Express has better interview familiarity) |
| Database | MongoDB + Mongoose | PostgreSQL (rejected — see ARCHITECTURE.md decision log) |
| Real-time | Socket.IO | raw `ws`, SSE, long polling (see REALTIME.md decision log) |
| Auth | JWT (access + refresh), httpOnly cookies | Session store (rejected — stateless auth fits a single-instance app and is more common in interviews) |
| Password hashing | bcrypt | argon2 (documented alternative, see BACKEND.md) |
| Validation | Zod | Joi, express-validator (see BACKEND.md decision log) |
| Frontend server-state | TanStack Query | plain fetch+useEffect (see FRONTEND.md) |
| Frontend client-state | Zustand | Redux Toolkit, Context-only (see FRONTEND.md) |
| Styling | Tailwind CSS, heavily customized config (no default component-kit look) | CSS Modules, styled-components (see FRONTEND.md decision log) |
| Language | JavaScript | TypeScript only if explicitly requested later |

Do not swap any of these without updating the relevant doc's decision log first.

## 4. Folder Structure Expectations

```
/
├── CLAUDE.md
├── PROJECT_SPEC.md
├── ARCHITECTURE.md
├── BACKEND.md
├── FRONTEND.md
├── REALTIME.md
├── TESTING.md
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── sockets/
│   │   ├── validation/
│   │   ├── utils/
│   │   └── app.js / server.js
│   └── tests/
└── frontend/
    ├── src/
    │   ├── api/
    │   ├── components/
    │   ├── pages/
    │   ├── hooks/
    │   ├── store/
    │   ├── sockets/
    │   └── App.jsx
    └── tests/
```
(Exact structure finalized in BACKEND.md / FRONTEND.md before implementation.)

## 5. Coding Conventions

- **Controllers are thin.** They parse/validate the request, call a service, shape the response. Business logic lives in services, not controllers.
- **No logic in Mongoose models beyond schema, indexes, and simple instance/static helpers** (e.g., `comparePassword`). Query composition belongs in services.
- **One responsibility per Socket.IO handler.** Each event has its own named handler function, registered in `sockets/`, never inline anonymous functions with mixed concerns.
- **Async/await everywhere**, no callback-style Mongoose or raw `.then()` chains mixed with await.
- **Every route handler and socket handler is wrapped for error safety** (`asyncHandler` on REST, try/catch + structured `error` emit on sockets) — never let an unhandled rejection crash the process or hang a socket.
- Environment variables are read once in `config/`, never inline `process.env.X` scattered through business logic.

## 6. Security Requirements

- Passwords hashed with bcrypt (cost factor documented in BACKEND.md) — never logged, never returned in any API response.
- JWTs delivered via `httpOnly`, `Secure`, `SameSite=Strict` cookies — never stored in `localStorage`. `Strict` is chosen (not `Lax`) because this app has no cross-site entry flow (no OAuth redirect, no third-party embed) that would need the cookie attached on a cross-site navigation — see ARCHITECTURE.md's decision log.
- All REST input validated server-side with Zod schemas before touching the database, regardless of client-side validation.
- All Socket.IO event payloads validated server-side before use — a socket is a persistent open input channel and must be treated with the same suspicion as an HTTP body.
- Every conversation-scoped REST route and socket event re-verifies the authenticated user is a participant of that conversation — authorization is never inferred from a client-supplied ID alone.
- Message size capped (see BACKEND.md) and enforced server-side, not just in the UI.
- Rate limiting applied to auth endpoints and to socket message emission.
- All rendered message content is treated as untrusted text on the frontend — rendered via React's default text interpolation (never `dangerouslySetInnerHTML`) so it can never execute as HTML/JS.

## 7. Authentication Requirements

- Registration: email + password (+ display name), password hashed before persistence.
- Login: issues short-lived access token + longer-lived refresh token, both httpOnly cookies; creates a per-device `Session` document (BACKEND.md §6a) that the refresh token is bound to.
- Logout: clears cookies server-side and deletes **only the caller's own** `Session` — this must never invalidate another device's session (resolved 2026-08-31; see BACKEND.md §6a for the full multi-device logout design and why a single global revocation counter was rejected). A separate `logout-all` action exists for the "revoke everywhere" case and additionally disconnects live sockets for that user.
- Socket connections authenticate during the handshake using the same JWT (read from the cookie) — no anonymous sockets are ever admitted to conversation rooms.
- Token refresh flow documented in BACKEND.md; do not implement silent client-side token storage workarounds.

## 8. Authorization Requirements

- Authorization = "is this authenticated user allowed to act on this resource," checked **after** authentication, on every request/event that touches a conversation or message.
- Never trust a `conversationId` or `roomId` passed by the client without checking DB membership server-side first.
- 403 (not 404) is returned when a resource exists but the user isn't authorized, unless deliberately masking existence is a documented decision (document if so).

## 9. REST Conventions

- Resource-oriented routes (`/api/conversations/:id/messages`), documented per-endpoint in BACKEND.md (method, auth, authz, request, response, errors) before implementation.
- Consistent JSON envelope for errors (defined in BACKEND.md).
- Pagination is cursor-based for message history (never offset-based — offset pagination breaks under concurrent inserts).

## 10. Socket.IO Conventions

- Event names are `namespace:action` (e.g. `message:send`, `message:new`, `typing:start`) — documented exhaustively in REALTIME.md's event table. Never introduce an event without adding it to that table first.
- One room per conversation (`conversation:<id>`) plus one room per user (`user:<id>`) for cross-device/tab delivery — rationale in REALTIME.md.
- Every client-emitted event that mutates state uses an acknowledgement callback; the client never assumes success from emission alone. An ack reflects **persistence** success only — a best-effort broadcast step happening after a successful persist is never allowed to turn an already-sent success ack into a failure (REALTIME.md §12a).
- Server never emits directly based on a client-claimed room/user without re-validating membership server-side first.
- Overlapping async operations on the same socket for the same conversation (e.g. `join`/`leave` fired in quick succession) resolve by "latest intent wins," not by whichever async check happens to finish first (REALTIME.md §7).

## 11. MongoDB Conventions

- Every query that filters by `conversationId` or `userId` is backed by an index (defined in BACKEND.md).
- No unbounded queries — message history is always paginated, using the exact tuple-comparison cursor specified in BACKEND.md §12 — never a single-field comparison that would break on a shared-millisecond timestamp.
- Schema and index changes are documented in BACKEND.md's model section before being written into a Mongoose schema file.
- **Concurrency-sensitive writes to a single document (counters, denormalized fields, status transitions) use atomic MongoDB update operators (`$inc`, conditional `$set`) — never `findById()` → mutate in JS → `.save()`, which races under concurrent writes to the same document.** See BACKEND.md §13a/§13b/§14 for the established patterns (conversation creation, unread-count increments, message status transitions).

## 12. Error-Handling Rules

- REST: centralized Express error-handling middleware; controllers throw/forward typed errors, never send ad-hoc `res.status().json()` error shapes inline.
- Sockets: handler-level try/catch that emits a structured `error` event back to the originating socket with a stable error code — never let a thrown error silently drop an event or crash the socket namespace.
- Distinguish operational errors (bad input, unauthorized, not found — expected, handled) from programmer errors (bugs — logged loudly, not swallowed).

## 13. Testing Requirements

- No feature is marked done without its edge cases covered per TESTING.md's edge-case matrix.
- New REST endpoints get integration tests (request → DB state → response).
- New Socket.IO events get tests covering at minimum: happy path, unauthorized actor, malformed payload, and (where relevant) duplicate/replay behavior.
- Testing strategy is written *before* implementation for any new real-time feature (see TESTING.md philosophy).

## 14. Documentation Requirements

- Any new architectural decision gets a decision-log entry (DECISION / WHY / ALTERNATIVES / TRADEOFF / INTERVIEW EXPLANATION) in the relevant doc — see ARCHITECTURE.md for the format and existing examples.
- REALTIME.md's event table and TESTING.md's edge-case matrix are updated in the same change that adds the feature they describe, not after.
- Project-level docs (this file, PROJECT_SPEC.md, ARCHITECTURE.md, BACKEND.md, FRONTEND.md, REALTIME.md, TESTING.md) describe *our* implementation. Conceptual/knowledge notes (e.g. `[[Socket.IO]]`, `[[Idempotency]]`) describe the underlying technology in general and are kept separate — do not blend the two.

## 14a. External Tooling Availability

Checked at the start of Milestone 0 (2026-08-31). Do not assume these are connected in a future session without re-checking — availability can change between environments.

| Tool | Status | Implication |
|---|---|---|
| Context7 MCP | Available | Use for up-to-date library docs (React, Express, Mongoose, Socket.IO, etc.) per the global Context7 instructions. |
| 21st.dev MCP | **Not available** | No component-catalog lookup. Frontend components are hand-authored per FRONTEND.md's design-system direction; do not claim to have consulted it. |
| React Bit MCP | **Not available** | Same as above — no external component-inspiration tool; interaction patterns are designed directly, referencing general React/accessibility best practice instead. |
| Graphify | **Not available** | No automated knowledge-graph tooling. |
| Obsidian MCP/integration | **Not available** | Docs are still written Obsidian-friendly by convention: `[[Wiki-style links]]` for concepts, Mermaid diagrams for flows (see ARCHITECTURE.md, REALTIME.md). A human can open this repo as an Obsidian vault later with no changes needed. |

If a future session finds any of these newly available, verify with the actual tool/MCP list before using it, then update this table.

## 15. Git / Commit Expectations

- Commits are scoped and message-explained (what changed and why), not "wip" or "fix stuff."
- Do not commit `.env` files or secrets.
- Do not amend or force-push shared history.
- A commit that adds a feature also includes its tests and doc updates where applicable — don't split "add feature" from "add tests for feature" across unrelated commits.

## 16. Things Claude Must Never Do

- Never write application code before the relevant doc section exists and has been (at least implicitly) approved.
- Never introduce a new dependency without stating why it's needed and what it replaces/avoids.
- Never trust client-supplied identity/authorization data.
- Never store JWTs in `localStorage` or render unsanitized message content as HTML.
- Never mark a feature "production-ready" on the basis of local success alone — call out what's still missing for real production readiness (TLS termination, secrets management, monitoring, horizontal scaling, etc.) if asked about production readiness.
- Never introduce Redis, queues, or additional services without an explicit request.
- Never silently skip an edge case from TESTING.md's matrix — either handle it or explicitly flag it as deferred, with reasoning.

## 17. How Claude Should Approach New Features

1. Check whether the feature is already scoped in PROJECT_SPEC.md / ARCHITECTURE.md / REALTIME.md.
2. If it changes the data model, propose the model change explicitly before writing schema code.
3. If it introduces a new socket event, add it to REALTIME.md's event table first.
4. Write the testing strategy (or at least the edge cases) before or alongside implementation, per TESTING.md philosophy.
5. Implement, then update docs to match the as-built reality if anything changed during implementation.

## 18. How Claude Should Handle Uncertainty

- If a decision has real tradeoffs (as most in this project do), state the tradeoff and pick one, using the DECISION/WHY/ALTERNATIVES/TRADEOFF format — don't leave it unresolved in code.
- If the uncertainty is about *user intent* (not a technical tradeoff Claude can reasonably resolve), stop and ask rather than guessing — this is an interview-prep project, not a throwaway prototype, so silent wrong guesses cost real learning value.
- Never fabricate an "interview explanation" that doesn't match what was actually implemented.

## 19. How Claude Should Verify Completed Work

- Re-read the relevant doc section and confirm the implementation matches the documented contract (endpoint shape, event payload, auth/authz rule).
- Run the tests associated with the feature; do not claim something works without running it.
- Walk through the edge-case matrix entries relevant to the feature and confirm each is either handled or explicitly deferred.
- For UI-affecting work, actually exercise it (see project-level tooling for browser verification) rather than asserting success from code review alone.

## 20. Milestone Roadmap

**PROJECT_SPEC.md §19 "Master Milestone Roadmap" is the authoritative, fully detailed roadmap** — every milestone's goal, why it exists, tasks, dependencies, deliverables, acceptance criteria, testing requirements, edge cases, docs-to-update, and interview concepts. This section is only a quick-reference index so the git-commit workflow above (§15) has something local to point at; do not let it drift into a second source of truth — update PROJECT_SPEC.md, not this table, when milestone scope changes.

Living index — update statuses (`[ ]` / `[~]` / `[x]`) as milestones complete. Each milestone is scoped to **one clear goal**; do not combine milestones or start the next one without explicit user instruction (see §15/§16). M0 covers the *entire* project's planning, not just itself — implementation milestones (M1+) don't begin until the whole master plan is approved.

| ID | Milestone | Depends on |
|---|---|---|
| [x] M0 | Master Planning (product, architecture, DB, REST, sockets, frontend, security, testing, deployment, full roadmap) | — |
| [x] M1 | Repository Setup & MERN Foundation | M0 |
| [x] M2 | Authentication & User Management | M1 |
| [x] M3 | Users & Conversation REST APIs | M2 |
| [x] M4 | Socket.IO Foundation & Connection Lifecycle | M2, M3 |
| [x] M5 | Basic Real-Time Messaging | M3, M4 |
| [x] M6 | Persistent Message History & Pagination | M5 |
| [x] M7 | Presence & Typing Indicators | M4 |
| [x] M8 | Read Receipts, Delivery State & Unread Counts | M5, M6 |
| [x] M9 | Reconnection, Offline Sync & Idempotency | M5, M6, M8 |
| [ ] M10 | Backend Security Hardening, Validation & Rate Limiting | M2–M9 |
| [ ] M11 | Frontend Foundation | M0, M3 |
| [ ] M12 | Authentication UI | M2, M11 |
| [ ] M13 | Conversation UI | M3, M6, M12 |
| [ ] M14 | Real-Time Messaging UI | M4, M5, M9, M13 |
| [ ] M15 | Presence / Typing / Read Receipt / Unread UI | M7, M8, M14 |
| [ ] M16 | Responsive Design, Accessibility & Visual Polish | M11–M15 |
| [ ] M17 | Automated Testing & Failure Scenarios | M2–M16 |
| [ ] M18 | Deployment, Logging & Observability | M1–M17 |
| [ ] M19 | Final Audit, Documentation & Interview Preparation | M1–M18 |

**Change from the originally proposed 15-item outline:** frontend work is split into five focused milestones (M11–M15: foundation, auth UI, conversation UI, real-time messaging UI, presence/typing/receipt UI) instead of one or two — a single frontend milestone would have covered routing, every screen, every real-time UI surface, and visual polish at once, too many unrelated concerns to review against one acceptance-criteria list. Security also gets its own dedicated milestone (M10) rather than being folded into "testing," since it's a distinct audit discipline (re-verifying trust boundaries) rather than a testing-coverage exercise. Net result: 19 implementation milestones instead of 14, each small enough to actually review.
