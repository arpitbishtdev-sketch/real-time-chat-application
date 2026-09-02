# PROJECT_SPEC.md — Real-Time Chat Application

## 1. Project Overview

A standalone 1-to-1 real-time chat application built with the MERN stack + Socket.IO, built to demonstrate interview-grade competence in backend API design, real-time systems, data modeling, authentication/authorization, reliability engineering, and security engineering.

## 2. Target Users

A single persona: a registered user who logs in, finds other users, and exchanges real-time text messages with them 1-to-1. No public/anonymous chat, no guest mode.

## 3. Core User Stories

1. As a new user, I can register with an email, password, and display name.
2. As a returning user, I can log in and log out.
3. As a logged-in user, I can view and edit my profile (display name, avatar, status text).
4. As a logged-in user, I can search for other users by name/email.
5. As a logged-in user, I can start a 1-to-1 conversation with another user.
6. As a logged-in user, I can see a list of my conversations, ordered by most recent activity, with unread counts.
7. As a logged-in user, I can open a conversation and see its persistent message history, paginated.
8. As a logged-in user, I can send a message and see it appear instantly for the recipient if they're online.
9. As a logged-in user, I can see when the other participant is typing.
10. As a logged-in user, I can see whether the other participant is online, and if not, their last-seen time.
11. As a logged-in user, I can see the delivery/read state of my sent messages.
12. As a logged-in user, if I lose connection and reconnect, I don't lose or duplicate any messages.
13. As a logged-in user, I can have the app open in multiple tabs/devices and have a consistent experience across them.

## 4. Functional Requirements

- Registration / login / logout with JWT-based auth.
- User profile read/update.
- User search (by name or email, case-insensitive, prefix or substring match).
- Conversation creation (1-to-1 only), idempotent (creating a conversation with the same pair returns the existing one).
- Conversation list with last message preview, timestamp, unread count.
- Message send/receive over REST (persistence) and Socket.IO (real-time delivery).
- Paginated message history (cursor-based, newest-first with "load older" pagination).
- Unread message counts, per conversation, cleared on read.
- Typing indicators (start/stop, auto-expire).
- Online/offline presence with last-seen timestamp.
- Message delivery states: `sent` → `delivered` → `read`.
- Read receipts.
- Reconnection with missed-message synchronization.
- Duplicate-message protection via client-generated idempotency key.
- Rate limiting on auth and message-send.
- Input validation and message size limits.
- XSS-safe message rendering.

## 5. Non-Functional Requirements

- **Reliability:** no message is lost between "sender clicked send" and "message persisted," even across a dropped connection. See ARCHITECTURE.md's message lifecycle.
- **Consistency:** MongoDB is the single source of truth; Socket.IO state is always reconcilable against it.
- **Security:** authentication and authorization enforced server-side on every REST route and every socket event; no security decision made client-side alone.
- **Explainability:** every mechanism must be simple enough to whiteboard and defend in an interview — no unexplainable "magic."
- **Single-instance scale target:** the system is designed to run correctly and defensibly on one Node.js instance. Horizontal-scaling considerations are documented (ARCHITECTURE.md) but not implemented.
- **Performance target (soft):** message round-trip (sender emit → recipient receive, both online) under ~150ms on localhost; conversation list and message history endpoints paginate rather than load unbounded data.

## 6. MVP Scope

- Registration, login, logout (JWT + httpOnly cookies).
- User profile (view/edit self, view others).
- User search.
- 1-to-1 conversation creation + listing.
- Real-time messaging with persistence.
- Message history with pagination.
- Unread counts.
- Typing indicators.
- Online/offline presence + last seen.
- Delivery + read receipts.
- Reconnection + missed-message sync.
- Duplicate protection.
- Core security: validation, rate limiting, authz checks, XSS-safe rendering.

## 7. Future Scope (explicitly deferred, not in MVP)

- Group conversations (>2 participants).
- Message editing / deletion / reactions.
- File/image attachments.
- Push notifications (browser/mobile).
- Full-text message search.
- Message soft-delete / retention policies beyond a basic `deletedAt` flag.
- Horizontal scaling (Redis adapter for Socket.IO, sticky sessions/shared pub-sub).
- Admin/moderation tooling.
- Socket connection-attempt rate limiting (as opposed to `message:send` limiting, which is in MVP scope) — deliberately deferred; see REALTIME.md §25a for the reasoning and the smallest mechanism to add if this is ever revisited.
- "Your active devices" UI (list/revoke individual sessions) — the `Session` model (BACKEND.md §6a) supports this, but no UI is built for it in MVP; `POST /auth/logout-all` covers the one capability actually needed now (revoke everything).

## 8. Explicitly Out of Scope

Per project instructions — not to be added even opportunistically:

- Voice/video calls.
- Stories/status updates.
- Payments/monetization.
- Microservices split.
- Kubernetes, Kafka, or any infra beyond a single Node process + MongoDB.

## 9. User Roles

Single role: **authenticated user**. No admin/moderator role in MVP. All users have identical capabilities, scoped to conversations they participate in.

## 10. Conversation Behavior

- Conversations are strictly 1-to-1 (exactly 2 participants) in MVP.
- Creating a conversation between two users who already have one returns the existing conversation (idempotent by sorted participant pair — enforced via a unique compound index, see BACKEND.md).
- A conversation is created lazily — searching for a user does **not** create a conversation; sending the first message (or explicitly opening a chat) does.
- Conversation list is sorted by `lastMessageAt` descending.
- Deleting/leaving a conversation is out of MVP scope (no destructive conversation actions).

## 11. Message Behavior

- Messages belong to exactly one conversation and one sender.
- Plain text only in MVP (no attachments/rich content).
- Server-enforced max length (documented in BACKEND.md — 4,000 characters).
- Empty/whitespace-only messages are rejected server-side.
- Messages are immutable once sent (no edit) in MVP; only their delivery/read status changes.
- Message ordering is authoritative by server-assigned `createdAt` + insertion order (`_id`), never by client-supplied timestamps.
- Each message carries a client-generated `clientMessageId` used for idempotent submission (see REALTIME.md's idempotency section).

## 12. Presence Behavior

- A user is "online" if they have at least one active socket connection.
- Presence is tracked per-user (not per-socket) — multiple tabs/devices collapse to a single online/offline state.
- `lastSeenAt` is updated when a user's last active socket disconnects (transition to fully offline).
- Presence changes are broadcast only to users who share a conversation with the affected user (not globally), to bound event fan-out.

## 13. Read Receipt Behavior

- A message transitions `sent` → `delivered` when it reaches an online recipient's socket (or immediately if the recipient is offline, deferred until their next connect — see REALTIME.md).
- A message transitions to `read` when the recipient has the conversation open/focused and the message enters view (client sends a `message:read` event, batched, up to the latest visible message).
- Read state is per-message (not per-participant array) because conversations are strictly 1-to-1 in MVP — this simplifies the schema; documented as a decision that would need to change for group chat.

## 14. Offline Behavior

- Sending to an offline recipient still persists the message (`sent` state) and is delivered on their next reconnect via room join + missed-message sync.
- The sender sees `sent` (not `delivered`) until the recipient actually connects and receives it.
- No push notifications in MVP — offline users see missed messages only on next app open.

## 15. Error Behavior

- REST errors return a consistent JSON error envelope with an HTTP status, a stable machine-readable code, and a human-readable message (BACKEND.md).
- Socket errors are emitted back to the originating socket via a structured `error` event / ack failure — never silently dropped.
- Client surfaces connection loss and reconnect attempts in the UI rather than failing silently (FRONTEND.md).

## 16. Security Requirements

See CLAUDE.md §6 for the authoritative list. Summarized: bcrypt password hashing, httpOnly/Secure JWT cookies, server-side validation (REST + sockets), server-side authorization re-checks on every conversation-scoped action, message size limits, rate limiting, XSS-safe rendering.

## 17. Reliability Requirements

- No message loss across a dropped/reconnected socket.
- No duplicate persisted messages from client retry (idempotency key).
- Message ordering preserved even under concurrent sends.
- Server restart does not corrupt state — all durable state lives in MongoDB; in-memory presence state is rebuilt from scratch (documented as an accepted limitation: all users appear offline immediately after a restart until they reconnect).

## 18. Feature Checklist

> Update this checklist as development progresses. `[ ]` not started, `[~]` in progress, `[x]` done + tested.

### Core
- [x] User registration
- [x] Login / logout
- [x] User profile (view/edit)
- [x] User search
- [x] 1-to-1 conversation creation
- [x] Conversation list (with unread counts, last message preview) — route/pagination/authz (M3); `unreadCount`/`lastMessageAt`/`lastMessagePreview` written atomically by M5's send path
- [x] Persistent message history + pagination — `GET /conversations/:id/messages` (M6)

### Real-Time
- [x] Instant messaging (Socket.IO) — authenticated connection lifecycle (M4) + live send/receive/broadcast via `message:send`/`message:new` (M5)
- [x] Conversation rooms — join/leave, membership authorization, join/leave race guard done (M4)
- [x] Typing indicators — `typing:start`/`typing:stop`/`typing:update`, server-side TTL backstop (M7, REALTIME.md §15)
- [x] Online/offline presence — per-user (not per-socket) collapse across tabs/devices, contact-scoped broadcasts (M7, REALTIME.md §8/§16)
- [x] Last seen — `User.lastSeenAt` set on last-socket disconnect, cleared on first-socket reconnect (M7)
- [x] Message delivery state (sent/delivered/read) — monotonic conditional-atomic transitions, never regress (M8, BACKEND.md §14, REALTIME.md §17a)
- [x] Read receipts — bulk "read up to X" watermark, `message:status` notifies the sender (M8, REALTIME.md §17)
- [ ] Reconnection handling

### Reliability
- [ ] Offline recipient handling
- [ ] Missed-message synchronization
- [ ] Network interruption recovery
- [x] Duplicate-message protection — `{conversationId, clientMessageId}` unique index + idempotent retry path (M5, REALTIME.md §13)
- [x] Message acknowledgements — `{ok, message?, error?}` ack contract (M5, REALTIME.md §11)
- [ ] Server restart recovery (documented degradation)
- [~] Multiple tabs/devices support — presence correctly collapses per-user across sockets, and `typing:update` correctly excludes every one of the typer's own sockets (M7); `message:status` reaches every one of the sender's tabs/devices, and two tabs of the same reader calling `message:read` concurrently converge to the higher watermark with no lost/negative unread count (M8); full guarantee (including frontend rendering) still depends on M14/M15
- [x] Message ordering guarantees — per-conversation in-process send-ordering chain (M5, BACKEND.md §13c); read-side tuple-cursor ordering, correct under same-millisecond ties (M6, BACKEND.md §12, TESTING.md #32)

### Security
- [x] Authentication (JWT + httpOnly cookies)
- [x] Authorization (per-route, per-event) — per-route (REST, M3), `conversation:join` (M4), `message:send` (M5), `typing:start`/`typing:stop` (M7), and `message:delivered`/`message:read` (M8) all done via the same `assertParticipant`; every socket event in REALTIME.md's event table as of M8 is covered
- [x] Conversation membership validation
- [x] Input validation (REST + sockets) — every REST endpoint and every socket event in REALTIME.md's event table as of M8 has server-side Zod validation before touching the DB
- [x] Message size limits — 4000-char cap enforced by Zod (pre-persistence) and Mongoose `maxlength` (M5)
- [~] Rate limiting — auth endpoints only so far (register/login/refresh); `message:send` limiting (TESTING.md #16) is audited/closed as part of M10's dedicated security pass, not M5 — corrected here to match PROJECT_SPEC.md §19's M5/M10 edge-case assignment, which this line had drifted from
- [x] Secure cookie/token handling
- [ ] XSS-safe message rendering

## 19. Master Milestone Roadmap

**This section is the authoritative, complete plan for the entire project** — every milestone from repository setup through final audit, each with its own goal, tasks, dependencies, deliverables, acceptance criteria, testing requirements, edge cases, docs to update, and interview concepts. CLAUDE.md §20 holds only a quick-reference index pointing here; update this section, not that one, when scope changes.

**Workflow reminder (see CLAUDE.md §17/§20 for the full rules):** M0 (this milestone) plans the *entire* project and stops for one master-plan approval. From M1 onward, each milestone is implemented, tested, reviewed, and reported individually — STOP after each one, wait for explicit approval, commit, then STOP again and wait for explicit instruction before starting the next. No milestone is combined with another, and none is started early because "we're already here."

### 19.1 Master Milestone Table

| ID | Milestone | Goal | Dependencies | Main Deliverables | Interview Focus |
|---|---|---|---|---|---|
| M0 | Master Planning | Design the complete product, architecture, and roadmap before any code | — | 7 root docs + this roadmap | Tradeoff articulation, scope discipline |
| M1 | Repository Setup & MERN Foundation | Runnable backend + frontend skeleton | M0 | Boots servers, DB connects, health check | Env config centralization, dev CORS/cookies |
| M2 | Authentication & User Management | Working auth REST flow, per-device sessions | M1 | Register/login/logout/logout-all/refresh, `Session` model | bcrypt, JWT access/refresh split, httpOnly cookies, per-device revocation |
| M3 | Users & Conversation REST APIs | Non-realtime conversation surface, race-safe | M2 | User search, race-safe idempotent conversation creation, paginated list | Idempotent creation via unique index + catch-and-refetch, exact cursor tuple comparison |
| M4 | Socket.IO Foundation & Connection Lifecycle | Authenticated real-time connections, race-safe join/leave | M2, M3 | Socket auth, room join/leave with membership re-check + "latest intent wins" | Socket auth vs. authz, rooms, async-ordering races |
| M5 | Basic Real-Time Messaging | Live send/receive + persistence, atomic metadata, ordered | M3, M4 | `message:send`/`message:new`, atomic conversation-metadata updates, per-conversation ordering | Ack callbacks, server-authoritative validation, atomic update operators, ack/broadcast isolation |
| M6 | Persistent Message History & Pagination | Correct, indexed paginated history | M5 | Cursor pagination with exact tuple comparison, ordering under concurrency | Compound indexes, concurrent-write ordering, same-millisecond boundary handling |
| M7 | Presence & Typing Indicators | Per-user presence + typing, TTL-safe | M4 | `presence:*`, `typing:*` events | Per-user vs. per-socket state, heartbeat/ping-timeout |
| M8 | Read Receipts, Delivery State & Unread Counts | Full `sent→delivered→read` lifecycle | M5, M6 | Delivery/read states, denormalized `unreadCount` | Idempotent/commutative state updates |
| M9 | Reconnection, Offline Sync & Idempotency | No loss/duplication across disconnects | M5, M6, M8 | Reconnection resync, `clientMessageId` dedup | At-least-once delivery, idempotency keys |
| M10 | Backend Security Hardening, Validation & Rate Limiting | Full security audit, gaps closed | M2–M9 | Verified authz on every route/event, rate limits | Defense in depth, systematic trust-boundary audit |
| M11 | Frontend Foundation | App shell, routing, design tokens | M0, M3 | Routing, Tailwind tokens, base components | Design-token theming vs. ad hoc utilities |
| M12 | Authentication UI | Working auth screens | M2, M11 | Register/login/logout screens, auth store | Silent token-refresh UX |
| M13 | Conversation UI | Browsable, non-live conversation experience | M3, M6, M12 | List, search, message history view | Cursor "load older" UX patterns |
| M14 | Real-Time Messaging UI | Live messaging in the browser | M4, M5, M9, M13 | Socket client, optimistic send, reconnection UX | Optimistic UI reconciliation |
| M15 | Presence / Typing / Read Receipt / Unread UI | Full real-time UX surface | M7, M8, M14 | Live presence/typing/receipt/unread UI | Multi-tab/device state consistency |
| M16 | Responsive Design, Accessibility & Visual Polish | Final design bar met across the app | M11–M15 | Responsive, a11y, motion, empty/loading polish | Accessibility as an acceptance criterion |
| M17 | Automated Testing & Failure Scenarios | Full 33-item edge-case matrix closed | M2–M16 | CI-runnable full test suite | Test-pyramid shape for a real-time app |
| M18 | Deployment, Logging & Observability | Reproducible deploy path + baseline logging | M1–M17 | Deployment docs, structured logging, health checks | Liveness vs. readiness, operational vs. programmer errors |
| M19 | Final Audit, Documentation & Interview Preparation | Zero drift, full defensibility | M1–M18 | Verified docs, verified app, re-run test suite | Full concept mastery across the project |

### 19.2 Detailed Milestone Breakdown

#### M1 — Repository Setup & MERN Foundation

**GOAL:** Stand up a buildable, runnable skeleton for both backend and frontend, matching CLAUDE.md §4's folder structure, with no feature logic yet.
**WHY IT EXISTS:** Every later milestone needs a running server, a running dev client, and a working DB connection to build against — getting this wrong early compounds across all 18 milestones that follow.
**TASKS:**
1. `git init`; `.gitignore` (`node_modules/`, `.env`, build output).
2. Scaffold `backend/` per CLAUDE.md §4 (`config/`, `models/`, `routes/`, `controllers/`, `services/`, `middleware/`, `sockets/`, `validation/`, `utils/`, `app.js`/`server.js`).
3. Scaffold `frontend/` via Vite + React per CLAUDE.md §4 (`api/`, `components/`, `pages/`, `hooks/`, `store/`, `sockets/`, `App.jsx`).
4. Install backend deps: express, mongoose, dotenv, cors, cookie-parser, bcrypt, jsonwebtoken, zod, socket.io, a request-logging library.
5. Install frontend deps: react-router-dom, @tanstack/react-query, zustand, socket.io-client, tailwindcss + config.
6. `config/` module reading all env vars once (port, Mongo URI, JWT secrets, cookie flags) — no scattered `process.env`.
7. MongoDB connection bootstrap with clear startup-failure logging.
8. Minimal Express app: CORS (credentials:true, explicit origin), cookie-parser, JSON body parsing, a `/api/health` route.
9. Centralized error-handling middleware skeleton (CLAUDE.md §12), even if just a default 500 handler for now.
10. Vite dev server proxy/CORS wired so the frontend can call `/api/*` in dev.
11. ESLint + Prettier config for both packages.
12. `.env.example` documenting required variables (no real secrets committed).
13. Root `README.md` — quick start: install, env setup, run both servers.
**DEPENDENCIES:** M0 (approved master plan).
**DELIVERABLES:** runnable `backend/` and `frontend/` skeletons; initialized git repo; `/api/health` returns 200; Vite dev server serves a blank React app; MongoDB connection confirmed locally.
**ACCEPTANCE CRITERIA:**
- Backend boots without error and connects to MongoDB.
- Frontend dev server boots and renders a blank page with no console errors.
- `GET /api/health` returns `200 {status:"ok"}`.
- Lint passes on both packages.
- No `.env`/secrets committed.
**TESTING REQUIREMENTS:** no feature tests yet; confirm the chosen test runner executes a trivial smoke test in both packages.
**EDGE CASES:** none yet (foundational milestone).
**DOCUMENTATION TO UPDATE:** BACKEND.md/FRONTEND.md folder structures reconciled against what was actually scaffolded if any drift occurred.
**INTERVIEW CONCEPTS:** monorepo vs. separate packages tradeoff; environment-variable centralization; CORS with credentialed cookies in local dev.

#### M2 — Authentication & User Management

**GOAL:** Working register/login/logout/refresh flow with bcrypt hashing and httpOnly cookies, per BACKEND.md's Auth endpoints and ARCHITECTURE.md's auth flow.
**WHY IT EXISTS:** Every other backend milestone requires an authenticated user; authorization checks throughout the app depend on this being correct and trustworthy first.
**TASKS:**
1. `User` Mongoose schema (BACKEND.md §14) with `select:false` on `passwordHash`, `toJSON` transform stripping sensitive fields.
2. `Session` Mongoose schema (BACKEND.md §14/§6a) with a TTL index on `expiresAt`.
3. Zod schemas: register, login, profile-update payloads.
4. `POST /auth/register` — hash password (bcrypt, cost 12), create user, create a `Session`, issue tokens (refresh token embeds that session's `_id` as `sid`), set cookies.
5. `POST /auth/login` — verify credentials, create a `Session`, issue tokens, set cookies.
6. `POST /auth/refresh` — verify refresh token signature, look up `Session` by `{_id: sid, userId}` (BACKEND.md §6a), reject if missing, issue a new access token.
7. `POST /auth/logout` — delete only the caller's own `Session` (by `sid` from their own refresh token), clear cookies. Never touches other devices' sessions.
8. `POST /auth/logout-all` — delete all of the caller's `Session` documents, clear cookies, disconnect the user's live sockets (`io.in(`user:<id>`).disconnectSockets()`).
9. `authenticate` middleware — verify access token from cookie, attach `req.userId`.
10. Centralized JWT helper (sign/verify access + refresh, shared secret/expiry from `config/`).
11. Rate limiting on `/auth/*` (BACKEND.md §10).
12. Error envelope for `VALIDATION_ERROR`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`.
13. Integration tests: register, login, logout, logout-all, refresh, duplicate email, wrong password, expired/invalid refresh token, cross-device logout isolation (see below).
**DEPENDENCIES:** M1.
**DELIVERABLES:** fully working auth REST flow with per-device session tracking; `authenticate` middleware reusable by every later protected route.
**ACCEPTANCE CRITERIA:**
- Full register→login→refresh→logout flow verified via integration test and manually via a REST client.
- `passwordHash` never appears in any response body or log line.
- Duplicate email returns `409 EMAIL_TAKEN`; wrong password returns `401 INVALID_CREDENTIALS`.
- Requests without a valid access token to a protected route return `401`.
- Auth rate limit triggers on rapid repeated attempts and returns a clean `429`.
- **Logging out on one device does not invalidate another device's refresh token** (two logins, two `Session`s, logout via one, assert the other still refreshes successfully) — TESTING.md #33.
- `POST /auth/logout-all` invalidates every device's refresh token and disconnects their live sockets.
**TESTING REQUIREMENTS:** integration tests for every endpoint and both middleware paths (authenticated/unauthenticated); unit tests for the JWT helper and bcrypt wrapper; the cross-device logout-isolation test above.
**EDGE CASES:** #10 (fake userId — `req.userId` always derives from the verified token, never the body), #24 (DB failure during user creation → clean 5xx, no partial doc), #33 (logout session isolation, new).
**DOCUMENTATION TO UPDATE:** PROJECT_SPEC.md feature checklist; BACKEND.md if the as-built contract differs from the proposal.
**INTERVIEW CONCEPTS:** bcrypt cost-factor tradeoffs; access/refresh token split; httpOnly + `SameSite=Strict` cookie rationale; per-device session revocation vs. a single global counter, and why the latter would have silently broken multi-device support.

#### M3 — Users & Conversation REST APIs

**GOAL:** User profile/search endpoints and 1-to-1 conversation creation/listing, per BACKEND.md §15.
**WHY IT EXISTS:** Conversations must exist and be authorizable before any messaging (REST or socket) can be built on top of them.
**TASKS:**
1. `Conversation` Mongoose schema (BACKEND.md §14) including the unique `participantsKey` index.
2. `GET /users/me`, `PATCH /users/me`.
3. `GET /users/search?q=` — case-insensitive prefix/substring match, excludes the requester.
4. `POST /conversations` — idempotent creation via `participantsKey`, **race-safe**: catches the `E11000` duplicate-key error from a concurrent creation attempt and re-fetches the existing document rather than letting it surface as a 500 (BACKEND.md §13a).
5. `GET /conversations` — cursor-paginated list with denormalized `lastMessagePreview`/`lastMessageAt`/`unreadCount`.
6. Conversation-membership check helper — reused by every conversation-scoped route/event from here on.
7. `GET /conversations/:id/messages` — route + auth/authz wiring, using the exact tuple cursor comparison from BACKEND.md §12 (returns an empty array until M5/M6 populate real messages; the pagination contract is validated now).
8. `POST /conversations/:id/read` — route/authz/shape wired (real read-state logic lands in M8).
9. Integration tests: idempotent creation, search behavior, pagination cursor correctness, 403 on non-participant access.
10. **Concurrency test: fire two `POST /conversations` calls for the same pair via `Promise.all`, assert exactly one `Conversation` document exists and both calls return it (no 500 from either)** — TESTING.md #26.
**DEPENDENCIES:** M2.
**DELIVERABLES:** full non-realtime conversation surface; a reusable membership-check helper used by every future conversation-scoped handler (REST and socket alike).
**ACCEPTANCE CRITERIA:**
- Creating a conversation twice between the same pair returns the same document (tested).
- **Creating a conversation between the same pair concurrently (`Promise.all`) also returns the same document from both calls, with no unhandled 500** — TESTING.md #26.
- A non-participant gets `403 FORBIDDEN` on every conversation-scoped route, never a data leak.
- Search excludes the requester and matches case-insensitively.
- The conversation-list cursor (`GET /conversations`, keyed on `(lastMessageAt, _id)` — BACKEND.md §12) is stable: no duplicate/skipped items across pages (tested).
**TESTING REQUIREMENTS:** integration tests for every endpoint, including the 403/404 authorization paths and the concurrent-creation race.
**EDGE CASES:** #9 (unauthorized conversation access), #12 (invalid conversation ID — malformed and well-formed-but-nonexistent), #26 (concurrent conversation creation, new).

**Note on TESTING.md #32 (resolved 2026-09-01):** an earlier draft of this milestone's acceptance criteria and edge-case list cited #32 (same-millisecond `Message.createdAt` cursor boundary) here. That test is physically impossible in M3 — the `Message` model doesn't exist until M5 (task 1 above defers `GET /conversations/:id/messages` to an empty-array stub for exactly this reason), so there is no `createdAt` to collide on yet. #32 is fully and exclusively owned by M6 (see M6 task 6/acceptance criteria below), which is the milestone that actually creates colliding-timestamp messages and queries them. M3 instead gets its own, real same-boundary-class test: the conversation-list cursor tie-breaking on `_id` when every conversation shares the same (absent) `lastMessageAt` — see the acceptance criterion above.
**DOCUMENTATION TO UPDATE:** BACKEND.md if the contract changed during implementation; PROJECT_SPEC.md checklist.
**INTERVIEW CONCEPTS:** idempotent resource creation via a unique compound index, including the catch-and-refetch pattern for the concurrent-creation race; cursor vs. offset pagination and the exact tuple-comparison boundary condition; authentication vs. authorization; 403-vs-404 existence-leak tradeoff (ARCHITECTURE.md §16, deliberately retained, not an oversight).

#### M4 — Socket.IO Foundation & Connection Lifecycle

**GOAL:** Establish authenticated real-time connections and conversation room management.
**WHY IT EXISTS:** All later real-time milestones (messaging, presence, typing, receipts) build directly on this connection/authorization layer; getting authorization wrong here compounds into every socket event after it.
**TASKS:**
1. Configure Socket.IO server, attached to the same HTTP server as Express.
2. Socket authentication middleware — reads the JWT from the handshake cookie, verifies it, rejects on failure (REALTIME.md §5).
3. Implement the connection lifecycle (connect → authenticated → idle → disconnect) per REALTIME.md §4.
4. Implement `conversation:join` — re-verify DB membership server-side before joining the room.
5. Implement `conversation:leave`.
6. Implement the `user:<id>` room join on connect (foundation for M7/M8's cross-device delivery).
7. Reject/no-op unauthorized `conversation:join` attempts per REALTIME.md's failure-behavior column.
8. Define the shared event-naming and acknowledgement-callback conventions used by every socket handler from here on (CLAUDE.md §10).
9. Socket-level error handling — structured `error` event, never an unhandled throw inside a handler.
10. Track socket→user and user→socket(s) mapping in memory (foundation for M7's presence, not presence itself).
11. Implement the "latest intent wins" join/leave ordering guard — a per-`(socketId, conversationId)` intent map so a `leave` that completes before an in-flight `join`'s membership check resolves isn't overridden by that stale join (REALTIME.md §7).
12. Socket tests: authenticated connect, unauthenticated connect rejection, authorized join, unauthorized join rejection, disconnect cleanup, join/leave race.
**DEPENDENCIES:** M2 (authentication), M3 (Conversation model + membership-check helper).
**DELIVERABLES:** authenticated socket connections; authorized `conversation:<id>` and `user:<id>` room membership; documented, tested connection lifecycle; race-safe join/leave.
**ACCEPTANCE CRITERIA:**
- An authenticated user can connect and the handshake succeeds.
- An unauthenticated (missing/invalid/expired token) connection is rejected with `connect_error`.
- A participant can join their conversation's room via `conversation:join` and receives `{ok:true}`.
- A non-participant's `conversation:join` is rejected with `{ok:false, FORBIDDEN}` and the socket is never added to the room (no broadcast leak, verified by test).
- Disconnect is handled cleanly (no unhandled exceptions; socket removed from in-memory maps).
- **A `join` immediately followed by a `leave` (with the join's membership check artificially delayed in the test) leaves the socket NOT in the room** — TESTING.md #27.
**TESTING REQUIREMENTS:** `socket.io-client`-based integration tests for every Acceptance Criteria item, including the join/leave race with a mocked/delayed membership check.
**EDGE CASES:** #9 (unauthorized conversation access via socket), #11 (unauthorized room join), #25 (socket connection failure — bad/expired token), #27 (join/leave race, new).
**DOCUMENTATION TO UPDATE:** REALTIME.md if the as-built lifecycle/event contract differs from the proposal.
**INTERVIEW CONCEPTS:** WebSocket handshake vs. HTTP request; Socket.IO; rooms; socket authentication vs. authorization; connection lifecycle; why membership is re-verified server-side rather than trusted from the client.

**Note on M4 as-built (resolved 2026-09-01):** all 12 tasks above were implemented as scoped, plus two points worth recording explicitly:
- **File split (approved during M4's discuss/plan phase):** `conversation:join`/`leave` and the intent map live in a new `sockets/conversation.handlers.js`, not inline in `sockets/index.js` — keeps `index.js` to auth middleware and connection-lifecycle wiring only (CLAUDE.md §5's one-responsibility rule), a small addition to BACKEND.md §1's original folder sketch.
- **Closed a loop M2 deliberately left open:** `auth.service.js`'s `logoutAllSessions` has called `io.in(user:<id>).disconnectSockets()` since M2, but `io` was undefined until `server.js` registered it via `app.set('io', io)` here — this milestone makes that call live and adds the first test able to verify it end-to-end (`tests/integration/socket.logoutAll.test.js`), closing out the socket-disconnect half of TESTING.md #33 that M2's tests could only mock.
- **Error-code correction:** `conversation:join`'s "conversation doesn't exist" ack uses `CONVERSATION_NOT_FOUND` (reusing `assertParticipant()`'s real M3 error code as-is), not the generic `NOT_FOUND` an earlier REALTIME.md §11 sketch used — corrected in that table rather than inventing a second code.
- **New dependencies:** `cookie` (parses the handshake's raw `Cookie` header — the one piece of cookie-parsing REST's `cookie-parser` doesn't expose standalone) and `socket.io-client` (devDependency, required by TESTING.md §5 to test against a real running Socket.IO server).

#### M5 — Basic Real-Time Messaging

**GOAL:** A sender can send a message that is persisted and delivered live to an online recipient, per REALTIME.md's `message:send`/`message:new` contract.
**WHY IT EXISTS:** This is the core value of the product — everything before it is infrastructure, everything after it is reliability/UX built on top of a working send/receive path.
**TASKS:**
1. `Message` Mongoose schema (BACKEND.md §14).
2. Zod schema for the `message:send` payload (`conversationId`, `text`, `clientMessageId`).
3. `message:send` handler: re-verify membership → validate payload → persist → ack → broadcast `message:new` to the conversation room.
4. Enforce max length (4,000 chars) and reject empty/whitespace-only text, server-side.
5. Acknowledgement callback contract (`{ok, message?, error?}`) implemented exactly per REALTIME.md §11.
6. Confirm the broadcast reaches all of a recipient's tabs/devices correctly (room-based, not per-socket exclusion logic).
7. Conversation-metadata atomic update — `unreadCount` unconditional `$inc`, `lastMessageAt`/`lastMessagePreview` conditional `$set` — on the genuine-insert branch only, never on a duplicate-`clientMessageId` retry (BACKEND.md §13b). **Note:** this lives here, in the same service call as message persistence, not in M6 — M6 only builds the *read*/pagination side on top of data this milestone already writes correctly.
8. Per-conversation in-process serialization (a `Map<conversationId, Promise>` chain) so rapid same-sender sends persist in the order they were sent, not in whatever order their DB writes happen to complete (BACKEND.md §13c).
9. Ack fires on persistence success only; the `message:new` broadcast is wrapped in its own isolated `try/catch` that can never turn an already-sent success ack into a failure (BACKEND.md §13d, REALTIME.md §12a).
10. Socket + integration tests: happy path, validation failures (empty/oversized/malformed), unauthorized sender, duplicate-retry metadata no-op, concurrent-distinct-message metadata atomicity, rapid-same-sender ordering, broadcast-failure/ack-success isolation.
**DEPENDENCIES:** M4 (socket foundation), M3 (Conversation model).
**DELIVERABLES:** end-to-end send→persist→broadcast path for online recipients, with race-safe conversation metadata and deterministic per-conversation ordering.
**ACCEPTANCE CRITERIA:**
- Sending a valid message persists it and returns `{ok:true, message}` in the ack.
- A second online, joined client receives `message:new` for it.
- Empty/whitespace-only, oversized (>4,000 chars), and malformed-type payloads are all rejected server-side with a clean ack error, never a crash.
- A non-participant's `message:send` is rejected.
- **A duplicate-`clientMessageId` retry does not double-increment `unreadCount` or re-touch `lastMessageAt`/`lastMessagePreview`** — TESTING.md #8.
- **Two concurrent, distinct messages (`Promise.all`) both correctly increment `unreadCount`, with no lost update** — TESTING.md #19.
- **Two rapid sends from the same sender persist with `createdAt` in actual send order, even when the first send's DB write is artificially delayed past the second's in a test** — TESTING.md #28.
- **A mocked broadcast failure after successful persistence still yields `{ok:true, message}` in the ack** — TESTING.md #29.
**TESTING REQUIREMENTS:** socket integration tests covering every Acceptance Criteria item; unit tests on the Zod schema boundaries; the four new concurrency/isolation tests above.
**EDGE CASES:** #1 (receiver online), #8 (duplicate message, extended to metadata idempotency), #10 (fake userId — sender always derived from `socket.userId`), #13 (invalid/malformed payload), #14 (empty message), #15 (oversized message), #19 (simultaneous messages, extended to metadata atomicity), #28 (same-sender ordering, new), #29 (persistence-succeeds/broadcast-fails, new).
**DOCUMENTATION TO UPDATE:** REALTIME.md/BACKEND.md if the payload shape changed during implementation; PROJECT_SPEC.md checklist.
**INTERVIEW CONCEPTS:** why message send is a socket event, not a REST endpoint; acknowledgement callbacks as a delivery-confirmation primitive; server-authoritative validation despite client-side checks; atomic MongoDB update operators as the fix for lost-update races, without needing transactions; in-process ordering guarantees and their single-instance scope limit; decoupling durability confirmation from best-effort live delivery.

#### M6 — Persistent Message History & Pagination

**GOAL:** Wire `GET /conversations/:id/messages` (scaffolded in M3) to real, paginated message data with correct ordering guarantees.
**WHY IT EXISTS:** A chat app is only useful if history survives and holds up under concurrent inserts — exactly the kind of correctness detail that's cheap to get right now and expensive to retrofit.
**TASKS:**
1. Implement the cursor-based query using the **exact tuple comparison** from BACKEND.md §12 (`$or` on `createdAt`/`_id`, not a naive `createdAt`-only filter) against the `{conversationId, createdAt, _id}` compound index (BACKEND.md §14).
2. "Load older" pagination direction (newest-first, stable `nextCursor`).
3. *(Conversation-metadata denormalized fields are written in M5, not here — this milestone only reads them.)*
4. Concurrency test: two participants sending near-simultaneously — assert both persist with a well-defined relative order and no lost write.
5. Verify pagination never returns duplicate/skipped messages across page boundaries under concurrent inserts.
6. **Same-millisecond boundary test:** insert two messages with an explicitly identical `createdAt` (bypassing normal auto-generation to force the collision), position a cursor on one of them, assert the other is returned exactly once — never skipped, never duplicated — TESTING.md #32.
7. Seed a conversation with several thousand messages and confirm the endpoint stays paginated and indexed (verified via an explain-plan check, not assumed).
**DEPENDENCIES:** M5 (messages now exist to paginate).
**DELIVERABLES:** fully correct, tested message history endpoint.
**ACCEPTANCE CRITERIA:**
- History loads correctly across multiple pages with a stable cursor.
- Two concurrent sends both persist, in a well-defined order, with no lost update (tested via `Promise.all`).
- **Two messages sharing the exact same millisecond `createdAt` are never skipped or duplicated across a pagination boundary** — TESTING.md #32.
- The query plan for the history endpoint uses the compound index.
**TESTING REQUIREMENTS:** integration tests for pagination correctness, the concurrency case, and the same-millisecond boundary case; an explicit index-usage check.
**EDGE CASES:** #19 (simultaneous messages), #20 (message ordering), #32 (same-millisecond cursor boundary, new).
**DOCUMENTATION TO UPDATE:** BACKEND.md if the index or query shape changed.
**INTERVIEW CONCEPTS:** cursor vs. offset pagination under concurrent writes; the exact tuple-comparison boundary condition and why a naive single-field comparator silently breaks at same-millisecond ties; compound index design for a hot query path; denormalization tradeoffs and where eventual consistency is acceptable.

#### M7 — Presence & Typing Indicators

**GOAL:** Online/offline presence collapsed per-user (not per-socket) with `lastSeenAt`, and typing indicators with server-side TTL expiry, per REALTIME.md §8/§15/§16.
**WHY IT EXISTS:** These are the first "soft realtime" features — they establish the multi-socket-per-user handling (multiple tabs/devices) that read receipts and messaging UI depend on later.
**TASKS:**
1. In-memory `userId → Set<socketId>` map (built on M4's connection tracking).
2. On connect: add the socket to the user's set; if it's the user's first socket, broadcast `presence:online` to shared-conversation contacts.
3. On disconnect: remove the socket from the set; if the set is now empty, set `lastSeenAt` and broadcast `presence:offline`.
4. Scope presence broadcasts to shared-conversation participants only (`user:<id>` room), never global.
5. `typing:start`/`typing:stop` handlers with membership re-check.
6. `typing:update` broadcast to the conversation room, excluding the typer's own sockets.
7. Server-side typing TTL — auto-expire (`typing:update {isTyping:false}`) if `typing:stop` never arrives.
8. Rely on Socket.IO's built-in ping-timeout to detect abrupt/uncleanly dropped sockets (stale presence).
9. Socket tests: multi-tab presence collapse, last-socket-drop triggers offline + `lastSeenAt`, typing TTL expiry, stale presence via abrupt disconnect.
**DEPENDENCIES:** M4 (socket foundation and connection tracking).
**DELIVERABLES:** working presence + typing indicator system, correctly per-user rather than per-socket.
**ACCEPTANCE CRITERIA:**
- A user with two open sockets (tabs) still shows online after closing one.
- `lastSeenAt` is set only when the user's *last* socket disconnects.
- Presence broadcasts reach only users who share a conversation with the affected user.
- `typing:update{isTyping:false}` fires within the documented TTL window if `typing:stop` never arrives.
- An abruptly killed connection still flips to offline within the ping-timeout window.
**TESTING REQUIREMENTS:** socket tests for every Acceptance Criteria item, including a forced-abrupt-disconnect simulation.
**EDGE CASES:** #4 (receiver disconnects mid-session), #17/#18 (multiple tabs/devices — presence collapse), #22 (typing indicator disconnect), #23 (stale presence).
**DOCUMENTATION TO UPDATE:** REALTIME.md if TTL values or broadcast scoping changed.
**INTERVIEW CONCEPTS:** per-user vs. per-socket presence modeling; why presence resetting on restart is an accepted, documented limitation; heartbeat/ping-timeout as an unclean-disconnect detector; fan-out scoping to bound broadcast cost.

#### M8 — Read Receipts, Delivery State & Unread Counts

**GOAL:** Full `sent → delivered → read` message lifecycle and denormalized `unreadCount`, per REALTIME.md §17 and BACKEND.md's schemas.
**WHY IT EXISTS:** This is the most race-condition-prone real-time feature in the app (two tabs marking read concurrently, delivery racing with a disconnect) — where idempotent/commutative design gets exercised, not just described.
**TASKS:**
1. `message:delivered` handler — recipient's client confirms receipt; **conditional** atomic update `{_id, status:'sent'} → {status:'delivered'}` (BACKEND.md §14) so it can never regress an already-`read` message backward.
2. `message:read` handler — bulk "read up to X" semantics, idempotent by construction (a higher watermark is always safe regardless of arrival order); always safe to apply since `read` is the terminal state.
3. `message:status` broadcast to the sender's `user:<senderId>` room on any status transition.
4. `POST /conversations/:id/read` REST fallback (scaffolded in M3) — same semantics as the socket event, for pre-socket-connect page loads.
5. `unreadCount` cleared to 0 on read (the *increment* is already handled atomically in M5's send path — this milestone only handles the clear side).
6. Concurrency test: two `message:read` calls with different `upToMessageId` values fired concurrently — assert the final state matches the higher watermark regardless of arrival order.
7. **Regression test: mark a message `read` first (fast reader), then deliver a late/stale `message:delivered` event for it afterward — assert status remains `read`, never regresses to `delivered`** — TESTING.md #30.
8. Offline-recipient delivery semantics: sender sees `sent` (not `delivered`) until the recipient's socket actually receives the message or their next reconnect sync picks it up.
**DEPENDENCIES:** M5 (messages exist, unreadCount increment already atomic), M6 (pagination/history correctness this builds on).
**DELIVERABLES:** complete delivery/read-state system; correct unread counts; monotonic status transitions.
**ACCEPTANCE CRITERIA:**
- Status transitions `sent → delivered → read` happen under the documented conditions and never regress backward.
- **A late `message:delivered` event arriving after a message is already `read` is a safe no-op, never a regression** — TESTING.md #30.
- `unreadCount` increments on receipt of a new message (M5) and clears exactly on read, never drifting.
- Two concurrent `message:read` calls converge to the higher watermark, not a race-dependent result (tested).
- An offline recipient's messages stay `sent` until they actually connect.
**TESTING REQUIREMENTS:** integration + socket tests for every Acceptance Criteria item, explicitly including the concurrency case and the delivered-after-read regression test.
**EDGE CASES:** #2 (receiver offline), #21 (read receipt races), #30 (delivered-after-read regression, new).
**DOCUMENTATION TO UPDATE:** REALTIME.md/BACKEND.md if the as-built read-state contract diverged.
**INTERVIEW CONCEPTS:** idempotent/commutative state updates ("set read up to X" vs. per-message toggles); monotonic state machines enforced via conditional atomic updates rather than application-level "if" checks (which would race); denormalized counters and where eventual consistency is acceptable.

#### M9 — Reconnection, Offline Sync & Idempotency

**GOAL:** No message loss or duplication across a dropped/reconnected socket, per ARCHITECTURE.md's reconnection/offline-sync lifecycle and REALTIME.md §13/§18/§19.
**WHY IT EXISTS:** This is the reliability core of the project's "design for failure" principle — the feature that most directly answers "what happens when this fails halfway through?"
**TASKS:**
1. Handle `{conversationId, clientMessageId}` unique-index conflicts in `message:send` — return the existing persisted message in the ack rather than erroring (safe retry).
2. Reconnection flow: on reconnect, the client re-authenticates, re-joins its active conversation room(s), and issues an `after`-cursor sync request for messages missed while disconnected.
3. Missed-message sync endpoint/event — returns messages created after a given cursor for a conversation, reusing M6's pagination machinery.
4. Client retry logic for `message:send` calls that never received an ack before disconnect (same `clientMessageId`, safe by task 1).
5. Confirm presence-on-restart behaves correctly: no crash/corruption when the in-memory presence map starts empty after a server restart, since MongoDB (the durable store) is unaffected.
6. Tests: duplicate submission after a simulated disconnect-before-ack, disconnect + message sent while offline + reconnect sync, **a real process restart** (see below — not a simulation) against a real MongoDB instance.
7. **Real process-restart test harness (resolved 2026-08-31 — replaces the earlier "or simulate" wording, which risked the real crash-recovery path never actually being exercised):** the test suite spawns the Express+Socket.IO server as an actual child process, connects a real `socket.io-client`, sends and confirms a message, kills the child process, restarts it, reconnects the client, and asserts: (a) the earlier message is still present via history fetch, (b) presence for all users starts "offline" post-restart, (c) reconnecting and re-syncing produces no duplicate messages. Documented here as its own harness (not folded into the fast unit/integration suite run on every save) because spawning a real process is slower — it runs as part of the full CI suite (M17), not the fast local loop.
**DEPENDENCIES:** M5, M6 (message send + pagination), M8 (read/delivery states this needs to reconcile on sync).
**DELIVERABLES:** reconnection + missed-message sync + duplicate-submission protection, fully tested against a real process restart, not a stand-in.
**ACCEPTANCE CRITERIA:**
- A `message:send` retried with the same `clientMessageId` after a disconnect-before-ack results in exactly one persisted document (tested).
- A message sent to an offline recipient is retrieved via the sync mechanism on their next reconnect, in correct order, without duplication.
- **A real, actual process restart** (not a mocked/simulated one) doesn't corrupt or lose any MongoDB-backed data; presence correctly starts "all offline"; reconnecting clients sync correctly with no duplicate messages — TESTING.md #7 (strengthened).
**TESTING REQUIREMENTS:** integration + socket tests for every Acceptance Criteria item, including the real-process-restart harness described in task 7.
**EDGE CASES:** #2 (receiver offline), #3 (sender disconnects mid-send), #5 (network interruption), #6 (reconnection), #7 (server restart, strengthened — real process, not simulated), #8 (duplicate message).
**DOCUMENTATION TO UPDATE:** REALTIME.md/ARCHITECTURE.md if the sync contract diverged from the proposal.
**INTERVIEW CONCEPTS:** idempotency keys; at-least-once delivery + client retry as a durability strategy; reconnection state reconciliation; why in-memory presence resetting is an accepted, documented tradeoff rather than a bug.

#### M10 — Backend Security Hardening, Validation & Rate Limiting

**GOAL:** A dedicated audit-and-close pass across every REST route and socket event, per CLAUDE.md §6 and TESTING.md's security-relevant edge cases.
**WHY IT EXISTS:** Security gets one deliberate milestone rather than being scattered as an afterthought across the others — this is where every conversation-scoped handler is explicitly re-verified against "never trust the client" in a single systematic pass.
**TASKS:**
1. Audit every REST route and socket event for: server-side Zod validation, authentication requirement, authorization (membership) re-check.
2. Confirm no route/event derives identity from a client-supplied field (`userId`, `senderId`, etc.) rather than the authenticated session.
3. Confirm message size limits are enforced both by Zod (pre-persistence) and Mongoose `maxlength` (defense in depth).
4. Confirm rate limiting on auth endpoints (M2) and `message:send` (REALTIME.md §25) is actually wired, not just documented.
5. Cross-reference XSS-safe rendering as a frontend concern (enforced in M14) rather than duplicating it here.
6. Audit database-failure handling — every persistence call has a catch path returning a clean failure shape, never a hang or crash.
7. **Sustained-outage test (new, resolved 2026-08-31 — the existing single-write-failure test doesn't cover a prolonged outage or recovery):** using `mongodb-memory-server`'s ability to stop/restart its instance mid-test, disconnect Mongo, fire several requests during the outage and assert each fails cleanly within the bounded `serverSelectionTimeoutMS` window (BACKEND.md §12) rather than hanging, then restart Mongo and assert subsequent requests succeed normally without an app restart — TESTING.md #31. This validates recovery *within what Mongoose's own reconnection behavior actually guarantees*; it does not claim to validate anything the current single-instance architecture can't actually provide (e.g. zero-downtime failover, which isn't a goal here).
8. Dependency audit (`npm audit` or equivalent) — no unaddressed critical/high vulnerabilities.
9. Close any gaps found via a security-focused test pass covering edge cases #9–#16 and #24.
10. **Confirm the connection-flooding deferral is documented, not silently absent** (REALTIME.md §25a, PROJECT_SPEC.md §7) — no implementation task here, since the decision was to explicitly defer it for this project's scope.
**DEPENDENCIES:** M2 through M9 (everything backend that needs hardening must exist first).
**DELIVERABLES:** a documented security audit result with any gaps found actually closed, not just listed; verified sustained-outage recovery behavior.
**ACCEPTANCE CRITERIA:**
- Every conversation-scoped route/event has a passing test proving unauthorized access is rejected.
- Every mutation-accepting route/event has a passing test proving spoofed identity fields are ignored.
- Rate limiting is verified to actually trigger under a test that exceeds the threshold.
- `npm audit` shows no unaddressed critical/high vulnerabilities in production dependencies.
- **A sustained MongoDB outage causes clean, bounded-time request failures (not hangs), and the app recovers automatically once MongoDB is available again, with no app restart needed** — TESTING.md #31.
**TESTING REQUIREMENTS:** the security-relevant subset of TESTING.md's edge-case matrix (#9–#16, #24) all pass with automated tests, plus the new sustained-outage test (#31).
**EDGE CASES:** #9, #10, #11, #12, #13, #14, #15, #16, #24 (audited and closed as a batch), #31 (sustained DB outage/recovery, new).
**DOCUMENTATION TO UPDATE:** TESTING.md (mark matrix rows verified); CLAUDE.md if any security convention needed correction based on audit findings.
**INTERVIEW CONCEPTS:** defense in depth (validation at multiple layers); rate-limiting strategies (token bucket, and why connection-attempt limiting was deliberately deferred rather than built); "never trust the client" applied systematically rather than case-by-case; bounded server-selection timeouts as the mechanism that turns "database down" into "clean, fast failures" instead of hung requests.

#### M11 — Frontend Foundation

**GOAL:** A running React app shell — routing, layout, Tailwind design tokens, and a small base component set — with no feature screens yet.
**WHY IT EXISTS:** Every subsequent frontend milestone needs a consistent shell (routing, design tokens, API client, socket-client scaffolding) to build inside, mirroring what M1 did for the backend.
**TASKS:**
1. React Router setup: public routes (login/register) vs. protected routes, with redirect logic for unauthenticated access.
2. Layout shell: app frame, navigation, responsive breakpoint scaffolding (FRONTEND.md §18).
3. Tailwind config using the custom design tokens from FRONTEND.md §20 (color scale, type scale, spacing unit) — not Tailwind defaults.
4. Base component set — Button, Input, Avatar, Skeleton/loading primitive, empty-state primitive — built to the visual language in FRONTEND.md §20, not a bundled kit.
5. API client (`api/client.js`) — fetch wrapper with `credentials:'include'`, centralized 401→refresh→retry logic (FRONTEND.md §5).
6. TanStack Query provider setup.
7. Zustand store scaffolding (`authStore` real; `presenceStore`/`typingStore` empty shells for M15).
8. Light/dark theme token wiring (CSS custom properties per FRONTEND.md §20), verified in both modes even with placeholder content.
9. Frontend test runner + a trivial smoke test (routing renders, protected route redirects when unauthenticated).
**DEPENDENCIES:** M3 (REST APIs the API layer will call), M0's approved design-system direction.
**DELIVERABLES:** a navigable, styled app shell with no real feature screens, ready for M12+ to build inside.
**ACCEPTANCE CRITERIA:**
- Visiting a protected route while unauthenticated redirects to login.
- Design tokens (not Tailwind defaults) are visibly applied — verified by inspecting rendered styles, not just config.
- Both light and dark themes render correctly with no unstyled/default-Tailwind-looking elements.
- Frontend smoke tests pass.
**TESTING REQUIREMENTS:** component/routing smoke tests; no feature tests yet.
**EDGE CASES:** none yet (foundational milestone).
**DOCUMENTATION TO UPDATE:** FRONTEND.md if folder structure or token values changed during implementation.
**INTERVIEW CONCEPTS:** protected-route patterns in React Router; design-token-driven theming vs. ad hoc utility classes; why the API client centralizes 401 handling instead of scattering it per-call.

#### M12 — Authentication UI

**GOAL:** Register/login screens wired to M2's REST API, with real auth state management.
**WHY IT EXISTS:** This is the first screen exercising the API-layer + auth-store pattern that every later screen reuses.
**TASKS:**
1. Register screen (form, validation feedback, error states) calling `POST /auth/register`.
2. Login screen calling `POST /auth/login`.
3. Logout action calling `POST /auth/logout`, clearing client-side auth state.
4. `authStore` (Zustand) populated from `GET /users/me` on app load; drives M11's protected-route redirect logic.
5. Form validation UX (client-side, mirroring but never replacing server-side Zod validation) with accessible error messaging (`aria-describedby`, FRONTEND.md §19).
6. Loading/error states for all three actions (FRONTEND.md §11/§12).
7. Silent-refresh handling: a 401 on any API call triggers the refresh-then-retry flow from M11's API client; a failed refresh redirects to login.
**DEPENDENCIES:** M2 (auth REST API), M11 (app shell, API client, base components).
**DELIVERABLES:** a real, usable register/login/logout flow exercised in an actual browser.
**ACCEPTANCE CRITERIA:**
- A new user can register, land authenticated, and see the (still-empty) main app shell.
- A returning user can log in and log out.
- Invalid credentials show a clear, accessible error message, not a raw API error.
- An expired access token triggers a silent refresh-and-retry without the user seeing a login prompt, unless the refresh itself fails.
- Verified by actually exercising the flow in a browser, not just code review (CLAUDE.md §19).
**TESTING REQUIREMENTS:** component tests for form validation; an E2E test for the full register→logout flow.
**EDGE CASES:** none from the matrix directly, but this is where #25's "expired/invalid token" client behavior is finally exercised end-to-end.
**DOCUMENTATION TO UPDATE:** FRONTEND.md if the auth-state contract diverged.
**INTERVIEW CONCEPTS:** client-side auth state as a reflection of, never a replacement for, server-verified state; silent token-refresh UX; accessible form error patterns.

#### M13 — Conversation UI

**GOAL:** Conversation list, user search, conversation creation, and message history view — all wired to REST (no sockets yet).
**WHY IT EXISTS:** This is the first screen touching real, paginated data at scale, and it's the milestone that makes the app "look like the product" for the first time.
**TASKS:**
1. Conversation list screen — `GET /conversations`, sorted by `lastMessageAt`, showing preview/unread count (visual only for now — live updates land in M15).
2. User search UI — `GET /users/search`, debounced input, empty/no-results states.
3. "Start conversation" flow — `POST /conversations`, idempotent-aware (opening an existing conversation doesn't create a duplicate).
4. Message history view — `GET /conversations/:id/messages`, cursor pagination ("load older").
5. Two-pane responsive layout (list + active chat) per FRONTEND.md §18, single-pane with back-navigation on mobile widths.
6. Loading/empty/error states for every one of the above.
7. Message bubble component — visual treatment per FRONTEND.md §20 (grouping consecutive messages from the same sender, timestamp/metadata de-emphasis).
**DEPENDENCIES:** M3 (conversation/user REST APIs), M6 (real paginated message data), M12 (authenticated session to build on).
**DELIVERABLES:** a fully browsable (but not yet live) conversation experience.
**ACCEPTANCE CRITERIA:**
- A user can search for another user, start a conversation, and see it appear in their conversation list.
- Message history loads and paginates correctly ("load older" fetches the next page without duplicating visible messages).
- Every empty/loading/error state has a real, designed treatment — no blank screens or unstyled default error text.
- Responsive behavior verified at mobile/tablet/desktop widths in an actual browser.
**TESTING REQUIREMENTS:** component tests for list/search/pagination logic; an E2E test for search→create→view-history.
**EDGE CASES:** none new from the matrix (ordering/pagination correctness was verified server-side in M6; this milestone verifies the UI renders it correctly).
**DOCUMENTATION TO UPDATE:** FRONTEND.md if component structure diverged.
**INTERVIEW CONCEPTS:** cursor-based "load older" UX patterns; contrast with M14's optimistic UI (not needed here since messaging isn't live yet); responsive two-pane-to-single-pane layout patterns.

#### M14 — Real-Time Messaging UI

**GOAL:** Socket.IO client integration — live message send/receive, optimistic UI, and reconnection UX, layered onto M13's static conversation view.
**WHY IT EXISTS:** This is where the frontend actually becomes "real-time" — and where M9's reliability work has to be reflected correctly in the UI, not just the backend.
**TASKS:**
1. `socketClient.js` — single socket.io-client instance, connect on authenticated app load, disconnect on logout.
2. `conversation:join`/`conversation:leave` wired to opening/closing a conversation view.
3. `message:send` wired to the send box, with `clientMessageId` generated client-side for idempotent submission.
4. Optimistic send: message appears immediately in a pending state, reconciled against the persisted message from the ack (or rolled back with a retry affordance on failure) — FRONTEND.md §10.
5. `message:new` handled — incoming messages merged into the TanStack Query cache without duplicating the sender's own optimistic entry.
6. Reconnection UX — a visible "Reconnecting…" state driven by Socket.IO client's reconnecting events (FRONTEND.md §13), and a resync of the active conversation on reconnect (consuming M9's missed-message sync).
7. Retry logic for a `message:send` that never got an ack before disconnect, reusing the same `clientMessageId`.
**DEPENDENCIES:** M4/M5 (socket foundation + send/receive), M9 (reconnection/idempotency this UI must reflect), M13 (static conversation view to make live).
**DELIVERABLES:** fully live, two-way real-time messaging in the browser, including the reliability behaviors from M9.
**ACCEPTANCE CRITERIA:**
- A message sent by one browser session appears live in another authenticated session without a page refresh.
- Optimistic send never results in a visible duplicate once the real message arrives via `message:new`/ack.
- Simulated network disconnect shows the reconnecting UI, and reconnecting resyncs any missed messages, in order, without duplicates.
- A retried send after a disconnect-before-ack doesn't create a duplicate message (mirrors M9's backend guarantee, verified from the UI).
**TESTING REQUIREMENTS:** E2E test (two browser contexts) for live delivery; E2E test with simulated network offline/online for reconnection.
**EDGE CASES:** #1 (receiver online), #3 (sender disconnect mid-send), #5 (network interruption), #6 (reconnection) — all re-verified from the client side.
**DOCUMENTATION TO UPDATE:** FRONTEND.md if the socket-client contract diverged.
**INTERVIEW CONCEPTS:** optimistic UI reconciliation against a server-confirmed event; client-side idempotency key generation; reflecting server-side reliability guarantees correctly in UI state rather than re-implementing them differently on the client.

#### M15 — Presence / Typing / Read Receipt / Unread UI

**GOAL:** Online/offline indicators, last-seen, typing indicators, read-receipt iconography, and live unread-count updates — the UI layer on top of M7/M8's backend work.
**WHY IT EXISTS:** These are the "soft realtime" signals that make the app feel alive; grouped together because they share the same multi-tab/multi-device correctness concerns.
**TASKS:**
1. `presenceStore` (Zustand) populated from `presence:online`/`presence:offline` events; online/offline dot + last-seen text (FRONTEND.md §15).
2. `typingStore` populated from `typing:update`; "X is typing…" indicator with the same de-emphasized metadata treatment as timestamps.
3. `message:delivered` emitted from the client on receipt of `message:new` (closing the loop from M8's backend logic).
4. `message:read` emitted when a message enters view in a focused, open conversation (batched, "up to latest visible").
5. Read-receipt iconography on the sender's own sent messages (single check / double check / filled double check) per FRONTEND.md §17.
6. Live `unreadCount` updates in the conversation list, without a manual refresh.
7. Multi-tab/multi-device correctness check: presence, typing, and read state stay consistent across two open tabs of the same user.
**DEPENDENCIES:** M7 (presence/typing backend), M8 (read receipts/unread backend), M14 (live messaging UI this layers onto).
**DELIVERABLES:** complete real-time UX surface — the app now reflects presence, typing, delivery, and read state live.
**ACCEPTANCE CRITERIA:**
- Presence dot and last-seen text update live without a refresh, and collapse correctly across multiple tabs of the same user.
- Typing indicator appears/disappears correctly, including when the typer disconnects ungracefully (relies on M7's TTL).
- Read-receipt icons progress `sent → delivered → read` live and correctly, verified across two authenticated browser sessions.
- Unread count in the conversation list updates live on a new message and clears on opening/reading the conversation.
**TESTING REQUIREMENTS:** E2E tests (two browser contexts) for presence, typing, and read-receipt propagation; a multi-tab test for state consistency.
**EDGE CASES:** #17 (multiple tabs), #18 (multiple devices), #21 (read receipt races, from the UI side), #22 (typing indicator disconnect), #23 (stale presence).
**DOCUMENTATION TO UPDATE:** FRONTEND.md if any store shape diverged.
**INTERVIEW CONCEPTS:** reflecting per-user (not per-socket) presence correctly with multiple tabs open; batched read-receipt emission to avoid an event-per-message flood; live socket-driven cache updates alongside TanStack Query's own cache.

#### M16 — Responsive Design, Accessibility & Visual Polish

**GOAL:** A dedicated final pass — responsive breakpoints, accessibility audit, motion, and the visual-design bar from FRONTEND.md §20 — applied across every screen built in M11–M15.
**WHY IT EXISTS:** Polish comes after every feature exists and works, not interleaved with feature-building, so the pass is comprehensive and reviewable against the design direction as a whole rather than piecemeal.
**TASKS:**
1. Full responsive audit at mobile/tablet/desktop breakpoints across every screen.
2. Full accessibility audit against FRONTEND.md §19: keyboard navigation, focus-visible states, `aria-live` regions, label associations, color-is-never-the-only-signal check.
3. Motion pass: apply FRONTEND.md §20's durations/easing consistently; verify `prefers-reduced-motion` is respected.
4. Empty-state visual pass across every screen (no conversations, no search results, empty history).
5. Loading-state visual pass — skeletons over spinners where specified, consistent styling.
6. Dark/light theme parity check across every screen, not just the M11 shell.
7. Cross-browser smoke check for layout/rendering regressions.
**DEPENDENCIES:** M11 through M15 (every screen this milestone polishes must already exist).
**DELIVERABLES:** the app, in full, meeting the visual/UX bar described in FRONTEND.md §20.
**ACCEPTANCE CRITERIA:**
- Every screen is usable and visually coherent at mobile, tablet, and desktop widths, verified in an actual browser.
- An accessibility spot-check (keyboard-only navigation through core flows; a screen-reader smoke pass) finds no blocking issues.
- No screen has an unstyled default/blank empty or loading state.
- `prefers-reduced-motion` is honored (verified by toggling the setting).
**TESTING REQUIREMENTS:** manual verification per FRONTEND.md §18/§19 (automated a11y tooling may supplement but doesn't replace an actual pass); regressions found get a regression test where practical.
**EDGE CASES:** none new — this milestone is a quality bar, not a new capability.
**DOCUMENTATION TO UPDATE:** FRONTEND.md — record any design-token or pattern adjustments as the new source of truth.
**INTERVIEW CONCEPTS:** why a dedicated polish milestone instead of polishing-as-you-go; accessibility as a first-class acceptance criterion; `prefers-reduced-motion` and other user-preference media features.

#### M17 — Automated Testing & Failure Scenarios

**GOAL:** Close every remaining gap in TESTING.md's 33-item edge-case matrix with an automated test, across every layer (unit/integration/socket/frontend/E2E).
**WHY IT EXISTS:** Individual milestones already tested their own acceptance criteria — this is the systematic reconciliation pass against the *complete* matrix, catching anything that fell through a milestone boundary.
**TASKS:**
1. Walk every row of TESTING.md's edge-case matrix; confirm an existing test covers it or write one.
2. Fill unit-level gaps (validation boundaries, JWT helper, idempotency-key logic).
3. Fill integration-level gaps (REST endpoints, DB-layer failure handling).
4. Fill socket-level gaps (every event's happy path, unauthorized actor, malformed payload, duplicate/replay).
5. Fill frontend/component-level gaps.
6. Fill E2E-level gaps (multi-tab, multi-device, network interruption scenarios).
7. Wire a CI-runnable test command (single command runs the full suite across backend/frontend).
8. Coverage review — a deliberate check that every documented failure mode has a corresponding test, per TESTING.md's philosophy (not a raw percentage target).
**DEPENDENCIES:** M2 through M16 (everything that could have edge cases must exist first).
**DELIVERABLES:** TESTING.md's edge-case matrix fully reconciled against real, passing automated tests (or explicit, reasoned deferrals).
**ACCEPTANCE CRITERIA:**
- All 33 rows of the edge-case matrix have a passing automated test, or are explicitly marked deferred in TESTING.md with reasoning (CLAUDE.md §16 — never silently skipped).
- The full test suite runs via a single command and passes.
**TESTING REQUIREMENTS:** this milestone's deliverable *is* the test suite.
**EDGE CASES:** all 33 — the full matrix, reconciled.
**DOCUMENTATION TO UPDATE:** TESTING.md — mark every matrix row's final status.
**INTERVIEW CONCEPTS:** test-pyramid shape for a real-time app; why socket events need their own test category distinct from REST integration tests; treating an edge-case matrix as a living contract, not a one-time checklist.

#### M18 — Deployment, Logging & Observability

**GOAL:** A documented, reproducible deployment path; structured logging; basic health/readiness signals.
**WHY IT EXISTS:** "Production-ready" claims require this even for a single-instance interview project, and it's the kind of thing that's easy to explain in an interview if it was actually done, and obviously absent if it wasn't.
**TASKS:**
1. Production build config for both backend (process manager guidance, env-based config) and frontend (Vite production build, static asset serving strategy).
2. Structured logging — distinguish operational errors (expected: bad input, auth failure) from programmer errors (bugs: logged loudly with stack traces) per CLAUDE.md §12.
3. Request logging (method, path, status, latency) without logging sensitive fields (passwords, tokens).
4. `/api/health` (liveness) and a readiness check (DB connectivity) distinct from each other.
5. Document the deployment path end-to-end (env vars, build steps, process start command) — a live deploy is optional/documented-as-possible, not mandatory, per PROJECT_SPEC.md's single-instance target.
6. Document — not implement — the horizontal-scaling trigger conditions and what would change (Redis adapter, shared presence store), cross-referencing ARCHITECTURE.md §17.
7. Process-level uncaught-exception/unhandled-rejection handlers that log loudly and fail fast rather than continuing in a corrupted state.
**DEPENDENCIES:** M1 through M17 (the whole app must exist to deploy/observe it).
**DELIVERABLES:** a documented, reproducible deployment path and baseline observability.
**ACCEPTANCE CRITERIA:**
- Following the documented deployment steps from a clean checkout produces a working instance (verified, not assumed).
- Logs clearly distinguish operational vs. programmer errors and never contain secrets/passwords/tokens.
- Liveness and readiness checks behave correctly (readiness fails if MongoDB is unreachable; liveness doesn't).
**TESTING REQUIREMENTS:** a scripted/documented deployment dry-run; a test confirming sensitive fields never appear in log output.
**EDGE CASES:** #24 (database failure — now also verified against the readiness check specifically).
**DOCUMENTATION TO UPDATE:** a new "Deployment" section extending ARCHITECTURE.md or BACKEND.md (extend rather than create a new root doc, per CLAUDE.md's fixed doc set).
**INTERVIEW CONCEPTS:** liveness vs. readiness checks; operational vs. programmer error distinction in logging; what "production-ready" actually requires beyond "it runs on my machine" (TLS termination, secrets management, monitoring — explicitly named as still-missing per CLAUDE.md §16).

#### M19 — Final Audit, Documentation & Interview Preparation

**GOAL:** Re-verify every doc matches as-built reality; consolidate interview-explanation content; final pass over every "must never" rule and the complete edge-case matrix.
**WHY IT EXISTS:** This is the milestone that actually delivers on the project's stated purpose — being able to defend every decision out loud — rather than assuming it fell out naturally from the previous 18 milestones.
**TASKS:**
1. Re-read every root doc against the actual codebase; fix any drift (CLAUDE.md's "never silently drift" rule).
2. Re-verify every acceptance criterion from every prior milestone still holds (nothing regressed silently across later milestones).
3. Re-run the full test suite from M17 and confirm it's still green.
4. Final pass over CLAUDE.md §16 ("Things Claude Must Never Do") — confirm none were violated anywhere in the codebase.
5. Consolidate every DECISION/WHY/ALTERNATIVES/TRADEOFF/INTERVIEW EXPLANATION entry across all docs into a single reference pass (confirm they're discoverable and consistent where they already live — not a new document).
6. Walk the "Final Objective" concept list from the original project brief and confirm each is genuinely explainable by pointing at real code + real docs, not just asserted.
7. Update PROJECT_SPEC.md's feature checklist to its final, accurate state.
**DEPENDENCIES:** M1 through M18 (this audits the entire finished application).
**DELIVERABLES:** a final, drift-free documentation set and a verified, defensible finished application.
**ACCEPTANCE CRITERIA:**
- No doc/code drift remains anywhere in the seven root docs.
- The full test suite passes.
- Every item in the Final Objective list can be walked through by pointing at specific files/docs, not from memory.
**TESTING REQUIREMENTS:** full suite re-run; no new tests expected unless the audit surfaces a real gap.
**EDGE CASES:** a final re-walk of all 33, confirming none regressed.
**DOCUMENTATION TO UPDATE:** all seven, as needed — this milestone's deliverable *is* doc accuracy.
**INTERVIEW CONCEPTS:** the entire concept list from the project brief — this milestone doesn't introduce a new concept, it verifies mastery of all of them.

### 19.3 Cross-Milestone Dependency Summary

- **Backend spine (linear):** M1 → M2 → M3 → M4 → M5 → M6. Each strictly requires the previous. Note: `Conversation` metadata (`unreadCount`, `lastMessageAt`, `lastMessagePreview`) is **written** in M5 (same service call as message persistence, per BACKEND.md §13b) and only **read** in M6 — this split was corrected during the pre-implementation audit, since the original draft had attributed the write to M6, which contradicted BACKEND.md's own persistence contract.
- **Backend real-time features (parallel-capable, but sequenced here for review manageability):** M7 depends only on M4; M8 depends on M5+M6; M9 depends on M5+M6+M8. M7 could technically be built before M6 finishes, but is sequenced after M6 to keep the "messaging fully works" milestone chain unbroken before layering soft-realtime features on top.
- **M10 (security)** intentionally depends on the *entire* backend feature set (M2–M9) — it's an audit of what exists, not a feature to build alongside.
- **Frontend spine (linear):** M11 → M12 → M13 → M14 → M15, each requiring both its frontend predecessor and its corresponding backend milestone(s) (e.g., M14 needs M9's reconnection guarantees to have something correct to reflect).
- **M16 (polish)** depends on all five frontend milestones being functionally complete first — polish is a pass over finished work, not a parallel track.
- **M17 (testing)** depends on the entire application (backend + frontend) existing, since it's the final reconciliation against the full edge-case matrix.
- **M18 (deployment) and M19 (final audit)** are strictly last — both require the complete, tested application.
