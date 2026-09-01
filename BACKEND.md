# BACKEND.md — Backend Design

Related concepts: [[REST API]] [[MongoDB]] [[Authentication]] [[Authorization]] [[Idempotency]]

> No APIs are implemented yet. This document defines the contract they must satisfy.

## 1. Backend Folder Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── env.js            # reads/validates process.env once
│   │   └── db.js              # mongoose connection setup
│   ├── models/
│   │   ├── User.js
│   │   ├── Session.js
│   │   ├── Conversation.js
│   │   └── Message.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   └── conversation.routes.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   └── conversation.controller.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── user.service.js
│   │   ├── conversation.service.js
│   │   └── message.service.js
│   ├── middleware/
│   │   ├── authenticate.js    # verifies JWT -> req.userId
│   │   ├── validate.js        # Zod schema-validation middleware factory
│   │   ├── rateLimit.js
│   │   └── errorHandler.js
│   ├── sockets/
│   │   ├── index.js                  # io.use auth middleware, connection lifecycle, handler registration (added M4)
│   │   ├── conversation.handlers.js  # conversation:join/leave + "latest intent wins" map (added M4 — deliberate split from index.js, see REALTIME.md §7)
│   │   ├── presence.js
│   │   ├── message.handlers.js
│   │   └── typing.handlers.js
│   ├── validation/
│   │   ├── auth.schema.js
│   │   ├── common.schema.js   # shared `objectId` Zod validator (added M3)
│   │   ├── user.schema.js
│   │   ├── conversation.schema.js
│   │   └── socket.schema.js   # conversation:join/leave payload shape (added M4)
│   ├── utils/
│   │   ├── AppError.js
│   │   ├── asyncHandler.js
│   │   ├── tokens.js          # sign/verify access & refresh JWTs
│   │   ├── cookies.js         # set/clear accessToken & refreshToken cookies (added M2 — shared by register/login/refresh/logout/logout-all)
│   │   └── cursor.js          # base64-JSON cursor encode/decode (added M3 — shared by conversation-list and, from M6, message pagination)
│   ├── app.js                  # express app, middleware wiring
│   └── server.js               # http server + socket.io attach + listen
└── tests/
    ├── integration/
    └── unit/
```

## 2. Express Middleware Architecture

Request pipeline (REST):

```
helmet → cors → cookie-parser → json body-parser → rateLimit (per-route)
   → authenticate (where required) → validate(schema) → controller → errorHandler
```

- `helmet`: sets standard security headers.
- `cors`: restricted to the frontend's origin, `credentials: true` (required for cookies to be sent cross-origin during local dev where frontend/backend run on different ports).
- `authenticate`: verifies the `accessToken` cookie's JWT, attaches `req.userId`; returns 401 if missing/invalid/expired.
- `validate(schema)`: parses `req.body`/`req.query`/`req.params` against a Zod schema; on failure returns 400 with field-level errors; on success, replaces the field with the parsed (typed/defaulted) value.
- `errorHandler`: last middleware, catches everything forwarded via `next(err)` or thrown inside `asyncHandler`-wrapped controllers.

## 3. Controllers / Services / Models split

- **Controllers**: translate HTTP ⇄ service calls. No business logic, no direct Mongoose queries.
- **Services**: business logic and orchestration (e.g., "create a conversation" = check existing → create → return). Own the Mongoose queries. Reused by both REST controllers and Socket.IO handlers so logic isn't duplicated across transports.
- **Models**: Mongoose schemas, indexes, and narrow instance/static helpers only (e.g. `User.prototype.comparePassword`).

## 4. Validation

**Decision: Zod** for both REST body/query/params validation and Socket.IO payload validation, using the *same* schema objects where the shape overlaps (e.g., message-send payload is identical over REST-less/socket-only messaging — see below, we send messages over sockets only, not REST, so there's no duplicate schema needed there; but conversation-creation and profile-update schemas are reused as-is).

**WHY:** One validation library for both transports means one mental model and no drift between "what REST accepts" and "what sockets accept." Zod's parse-and-infer pattern also documents the shape of data directly in code (self-documenting, and could later derive TypeScript types if the project ever adopts TS).
**ALTERNATIVES:** Joi (mature, widely used, no type inference), express-validator (REST-only, chainable but doesn't extend to socket payloads).
**TRADEOFF:** Zod is REST-framework-agnostic (a plus, since we need the same validation logic to run inside a socket handler with no `req`/`res`), at the cost of being a newer/less "default Express tutorial" choice — worth being able to explain in an interview.
**INTERVIEW EXPLANATION:** "I validate both REST and Socket.IO input with the same Zod schemas because a socket event is just as much untrusted input as an HTTP body, and I didn't want two different validation systems to maintain and potentially disagree."

## 5. Error Handling

`AppError` class: `{ statusCode, code, message, details? }`. Controllers/services `throw new AppError(...)` for expected/operational failures (validation already handled by middleware; this covers things like "not found," "conflict," "forbidden"). `asyncHandler(fn)` wraps every controller to forward rejected promises to `next(err)`.

Error response envelope:
```json
{
  "error": {
    "code": "CONVERSATION_NOT_FOUND",
    "message": "Conversation not found or you are not a participant."
  }
}
```
Unexpected (non-`AppError`) errors are logged with full stack server-side and returned to the client as a generic `500 INTERNAL_ERROR` — internals are never leaked in the response body.

## 6. Authentication Middleware

`authenticate(req, res, next)`:
1. Read `accessToken` from `req.cookies`.
2. Missing → 401 `NO_TOKEN`.
3. Verify JWT signature + expiry. Invalid/expired → 401 `INVALID_TOKEN` (frontend interprets this as "attempt refresh").
4. On success, set `req.userId = decoded.sub`.

Token details:
- **Access token**: 15 min expiry, payload `{sub: userId}`, signed with `JWT_ACCESS_SECRET`. Fully stateless — verified by signature alone, no DB lookup on every request (this is the whole point of using JWTs; see ARCHITECTURE.md §18's decision log). Its short expiry, not a per-request revocation check, is what bounds the exposure window of a compromised token.
- **Refresh token**: 7 day expiry, payload `{sub: userId, sid: sessionId}`, signed with `JWT_REFRESH_SECRET`, stored as an httpOnly cookie scoped to `/api/auth` (**corrected 2026-09-01** — originally scoped to `/api/auth/refresh` only, but that meant `POST /auth/logout`/`logout-all` never received the cookie at all, since a cookie's path scope isn't a prefix match across sibling routes; without it, single-device logout couldn't identify which `Session` to delete, silently doing nothing. `/api/auth` still keeps the token off every non-auth REST call — the actual isolation this scoping exists for — while reaching every auth endpoint that legitimately needs it). `sessionId` is the `_id` of a `Session` document (see §14) created at login. Unlike the access token, the refresh token **is** checked against the database on use — see §6a.

### 6a. Session Model & Multi-Device Logout Semantics

**Resolved 2026-08-31, replacing the earlier ambiguous `tokenVersion`-bump design (see ARCHITECTURE.md §18's JWT decision log for the full reasoning).**

**Problem this closes:** a single global `User.tokenVersion` counter, bumped on any logout, would invalidate *every* device's refresh token whenever the user logs out on *any one* device — silently breaking the project's own multi-device support goal (PROJECT_SPEC.md's edge case #18/#33). A logout on one device must not affect sessions on other devices.

**What identifies a session/device:** a `Session` document, one per login (i.e., one per issued refresh token, which in practice means one per browser/device that has ever logged in and not since logged out or expired). Fields:

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | auto — this **is** the `sid` embedded in that session's refresh token |
| `userId` | ObjectId (ref `User`) | indexed |
| `createdAt` | Date | auto (Mongoose timestamp) |
| `expiresAt` | Date | `createdAt + 7d`, matches the refresh token's own expiry |

No `userAgent`/`ip`/device-label fields are modeled in MVP — not needed for the revocation mechanism itself, and a "your active devices" UI is explicitly future scope, not required by any current milestone. Add them later only if that UI is actually built.

**Indexes:** `{userId: 1}` (lookup all of a user's sessions, for logout-all). `{expiresAt: 1}` as a **TTL index** (`expireAfterSeconds: 0`) — MongoDB automatically deletes expired sessions in the background; no cron job or app-level cleanup needed. This is the only new "infrastructure" this mechanism introduces, and it's a native MongoDB feature, not an added service.

**What logout invalidates:** `POST /auth/logout` reads the caller's own refresh token, extracts `sid`, and deletes **only that one** `Session` document, then clears that response's cookies. Every other device's `Session` document (and therefore its refresh token) is untouched and keeps working. The access token isn't force-revoked (it's stateless, per §6 above) — it simply expires naturally within 15 minutes and can no longer be renewed on that device, since its `Session` is gone.

**What "logout all devices" does:** a separate endpoint, `POST /auth/logout-all` (see §15), deletes **every** `Session` document for `req.userId`, clears the caller's own cookies, and additionally calls `io.in(`user:<userId>`).disconnectSockets()` (REALTIME.md §26) to immediately kick any currently-open sockets for that user, rather than waiting for their access tokens to expire naturally. This is the only case that needs the proactive socket-kick — a single-device logout does not, since it was never intended to affect other devices' live connections anyway.

**Resolved 2026-09-01 — M4:** this call was a documented no-op from M2 through M3 (`io` didn't exist yet). `server.js` now registers the live Socket.IO instance via `app.set('io', io)` immediately after creating it, so `logoutAllSessions` actually disconnects live sockets end-to-end — verified by `tests/integration/socket.logoutAll.test.js` connecting a real socket, calling logout-all, and asserting it receives `disconnect`.

**How REST authentication observes revocation:** the access-token check (`authenticate` middleware, §6) never queries the DB — unchanged, still fully stateless. Revocation is only observable at `POST /auth/refresh`: it looks up `Session.findOne({_id: sid, userId})`; missing (deleted or expired-and-TTL-reaped) → `401 INVALID_REFRESH_TOKEN`, exactly like today, just checked against a session document instead of a counter comparison.

**How Socket.IO authentication observes revocation:** unchanged from the original design — handshake verifies the access-token JWT signature/expiry only, no DB round trip (REALTIME.md §5). A socket connected before a logout-all keeps working until either (a) it's proactively disconnected by that flow's `disconnectSockets()` call, or (b) — if that call is somehow missed/delayed — its access token naturally expires and it can no longer refresh, since its `Session` is gone. This is the same short-exposure-window tradeoff already documented in REALTIME.md §26, now anchored to session deletion instead of a tokenVersion mismatch.

**What M2 must implement and test:**
- `Session` model + TTL index.
- Login creates a `Session` document and embeds its `_id` as `sid` in the signed refresh token.
- `/auth/refresh` looks up the session by `sid` + `userId`, rejects if missing.
- `/auth/logout` deletes only the caller's own session (by `sid` from their own refresh token — never a client-supplied session id).
- `/auth/logout-all` deletes all of the caller's sessions and disconnects their live sockets.
- **Test:** log in twice (two `Session` docs, two refresh cookies simulating two devices) → log out via device A's cookie → assert device B's refresh token still works.
- **Test:** `/auth/logout-all` → assert both devices' refresh tokens are now rejected.
- **Test:** an expired (past `expiresAt`) session is rejected at refresh even before the TTL reaper physically deletes it (defense in depth — don't rely on TTL timing alone).
- **Test:** a refresh token whose `sid` belongs to a *different* `userId` than its own `sub` claim is rejected (forged/mismatched session id).

## 7. Authorization Middleware

No generic "role check" middleware (single role in MVP). Instead, a per-route **membership check**, implemented as a small service function `assertParticipant(conversationId, userId)` called at the top of every conversation/message controller and every relevant socket handler — never inferred, always a fresh DB check against the authenticated `req.userId`/`socket.userId`.

## 8. Security Middleware

- `helmet` (security headers).
- `cors` (locked to frontend origin).
- `express-rate-limit` on `/api/auth/*` (see §10).
- `hpp` (HTTP parameter pollution guard) — optional, evaluate during implementation.
- Body size limit on JSON parser (e.g. `express.json({limit: '100kb'})`) as a blunt backstop, independent of the message-content length validated by Zod.

## 9. Password Hashing

**Decision: bcrypt**, cost factor 12.
**WHY:** Industry-standard, extremely well understood, simple to explain (no memory/parallelism parameters to justify), first-class Node support (`bcrypt` npm package), and cost factor 12 is a reasonable default balancing hashing time (~250ms) against brute-force resistance on current hardware.
**ALTERNATIVES:** argon2 (argon2id specifically) — OWASP's current top recommendation, memory-hard (more resistant to GPU/ASIC cracking than bcrypt).
**TRADEOFF:** argon2 is arguably the "more correct" modern answer and worth naming as the alternative, but bcrypt is more than adequate for this project's threat model and is the more universally recognized answer in a MERN interview context, with fewer parameters (memory cost, parallelism) to have to justify choosing.
**INTERVIEW EXPLANATION:** "I used bcrypt at cost factor 12. I know argon2id is the current OWASP-recommended default for new systems because it's memory-hard, and I'd pick it in a system with a higher-value threat model — for this project bcrypt is well understood and sufficient, and I can speak to why argon2 is the stronger choice if asked."

## 10. Rate Limiting

- `POST /api/auth/register`, `POST /api/auth/login`: 10 requests / 15 min / IP (via `express-rate-limit`), returns 429.
- `POST /api/auth/refresh`: 30 requests / 15 min / IP.
- Socket.IO `message:send`: token bucket per authenticated `userId`, enforced in the handler itself, not a library. **REALTIME.md §25 is the single authoritative source for the exact capacity/refill parameters** — not restated here, to avoid the two docs drifting out of sync (resolved 2026-08-31: an earlier draft of this line described "20 messages / 10 sec" here, which reads as a fixed-window rule, while §25 specifies a token bucket — mathematically compatible at the sustained rate but two different-sounding algorithms; only §25's token-bucket description is normative).

## 11. MongoDB Indexes (summary — full field lists in §14)

| Collection | Index | Purpose |
|---|---|---|
| `User` | `{email: 1}` unique | login lookup, uniqueness |
| `User` | text or regex-friendly index on `displayName` | user search |
| `Session` | `{userId: 1}` | look up/delete all of a user's sessions (logout-all) |
| `Session` | `{expiresAt: 1}` TTL (`expireAfterSeconds: 0`) | automatic cleanup of expired sessions, no cron job needed |
| `Conversation` | `{participantsKey: 1}` unique | idempotent 1-to-1 conversation creation (race-safe — see §13) |
| `Conversation` | `{participants: 1, lastMessageAt: -1}` | conversation list per user, sorted |
| `Message` | `{conversationId: 1, createdAt: -1, _id: -1}` | paginated history per conversation, and the compound cursor tuple (see §12) |
| `Message` | `{conversationId: 1, clientMessageId: 1}` unique | idempotent send / duplicate protection |

## 12. Pagination

**Decision: cursor-based**, using `(createdAt, _id)` as a compound cursor, newest-first.
**WHY:** Offset pagination (`skip`/`limit`) re-scans and re-counts skipped documents on every page (O(n) cost that grows with page depth) and produces incorrect results when new messages are inserted between page fetches (items shift, causing skipped/duplicated rows). A chat's message list is exactly the kind of frequently-mutating, append-heavy dataset where this bites hardest.
**ALTERNATIVES:** offset/limit (`skip`/`limit`), page-number-based pagination.
**TRADEOFF:** Cursor pagination can't jump to an arbitrary page number (only "next"/"previous" from a known cursor) — acceptable because chat UIs only ever scroll sequentially from "now" backwards, never jump to "page 7."
**INTERVIEW EXPLANATION:** "I used cursor-based pagination keyed on (createdAt, _id) because messages are a constantly-appending dataset — offset pagination would either be slow at depth or silently skip/duplicate messages if new ones arrive mid-scroll. `_id` breaks ties when two messages share a timestamp."

Response shape:
```json
{
  "messages": [ /* newest-first */ ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIuLi4iLCJfaWQiOiIuLi4ifQ==" // null if no more
}
```

**Exact cursor comparison (resolved 2026-08-31 — was previously left implicit as "compound cursor" without specifying the query shape, risking an off-by-one implementation that silently skips or duplicates a message sharing the exact same `createdAt` millisecond as the cursor boundary).** Given a cursor `c = {createdAt, _id}`, both directions use a **tuple comparison**, never a naive `createdAt` comparison alone:

- **Older direction** ("load older," `GET /conversations/:id/messages?cursor=`), sorted `(createdAt: -1, _id: -1)`:
  ```js
  { $or: [
      { createdAt: { $lt: c.createdAt } },
      { createdAt: c.createdAt, _id: { $lt: c._id } }
  ]}
  ```
- **Newer direction** ("missed-message sync" on reconnect, `GET /conversations/:id/messages?after=` — REALTIME.md §19), sorted `(createdAt: 1, _id: 1)`:
  ```js
  { $or: [
      { createdAt: { $gt: c.createdAt } },
      { createdAt: c.createdAt, _id: { $gt: c._id } }
  ]}
  ```

`_id` is the tiebreaker precisely because two messages can legitimately share the same millisecond `createdAt` under concurrent sends (edge case #19/#28) — comparing `createdAt` alone would either skip the boundary message (`$lt`/`$gt` strict) or return it twice (`$lte`/`$gte`), depending on which naive comparator was chosen. The tuple form is correct in both directions and is required, not optional, for both the history endpoint (M6) and the reconnection sync endpoint (M9). See TESTING.md #32 for the same-millisecond boundary test.

**Conversation-list cursor (resolved 2026-09-01 — M3):** `GET /conversations` uses the same tuple-cursor pattern, keyed on `(lastMessageAt, _id)`, sorted `(lastMessageAt: -1, _id: -1)`. This matters even before any messages exist: a brand-new conversation has no `lastMessageAt` at all, and MongoDB's sort/comparison order places a missing/`null` field before every real `Date` value — so `{lastMessageAt: -1}` alone already puts actively-messaged conversations above never-messaged ones, and `_id` breaks ties among conversations that share the same (possibly absent) `lastMessageAt`, exactly as `_id` does for messages above. The cursor query mirrors §12's `$or` shape, with `cursor.lastMessageAt` treated as `null` (matching both `null` and missing) rather than a sentinel date.
**DECISION:** reuse the tuple-cursor pattern rather than a `lastMessageAt`-only comparator. **WHY:** every conversation created in M3 has no messages yet, so a naive single-field cursor would tie on `undefined` for every row and silently skip/duplicate across a page boundary — the exact class of bug §12 already exists to prevent for messages. **ALTERNATIVE CONSIDERED:** sort by `createdAt` instead once a conversation has never been messaged, falling back only for ties — rejected as two different comparators to maintain and explain instead of one applied uniformly.

**Bounded connection timeouts (resolved 2026-08-31 — needed so a MongoDB outage fails requests cleanly instead of hanging indefinitely, per TESTING.md #31):** the Mongoose connection (`config/db.js`) sets `serverSelectionTimeoutMS: 5000` and `bufferCommands: false`. Without this, Mongoose's default behavior queues operations indefinitely while disconnected, which would turn "the database is briefly unavailable" into "requests hang forever" instead of "requests fail with a clean 5xx within ~5 seconds" — the actual documented invariant for edge case #24/#31.

## 13. Message & Conversation Persistence

- Message send happens over **Socket.IO only** in the primary flow (not duplicated as a REST endpoint) — REST is used to *read* history, sockets are used to *write* new messages, keeping the "one way to do it" principle from CLAUDE.md. (A REST fallback endpoint is deliberately not added in MVP; if the socket is disconnected, the client queues the send client-side and retries once reconnected — see REALTIME.md §Reconnection.)

### 13a. Conversation Creation Is Race-Safe (resolved 2026-08-31)

**Invariant:** exactly one `Conversation` document ever exists per participant pair, and every caller gets that document back — never a 500, regardless of timing.

The `{participantsKey: 1}` unique index (§11) already made this *possible*; this section specifies the *required* service-level handling, since "the index exists" alone doesn't close the race. Two concurrent `POST /conversations` calls for the same pair (e.g. both participants opening a chat with each other at the same instant) can both pass a "does this exist?" pre-check and both attempt an insert — exactly one insert succeeds, the other throws a MongoDB duplicate-key error (`E11000`) on `participantsKey`.

**Required behavior:** the conversation service's create path **must** catch that specific `E11000` and, on catching it, re-fetch the conversation by `participantsKey` and return it — never let the duplicate-key error propagate as an unhandled 500. The losing request's caller ends up with the exact same document the winning request created, indistinguishable from having called the idempotent path sequentially. See TESTING.md #26 for the concurrency test.

### 13b. Conversation Metadata Updates Are Atomic, Not Fetch-Then-Save (resolved 2026-08-31)

`Conversation.lastMessageAt`, `lastMessagePreview`, and `unreadCount.<recipientId>` are updated **only** on the branch where `message:send` actually inserts a new `Message` document — never on the duplicate-`clientMessageId`-retry branch (REALTIME.md §13), which returns the pre-existing message and does nothing further. This is what makes a retried send a true no-op beyond the ack: no second `Message`, no second unread increment, no incorrect metadata change.

On the genuine-insert branch, the update uses **two separate atomic single-document MongoDB operations** — never a `findById()` → mutate in JS → `.save()` round trip, which is a classic lost-update race under concurrent writes to the same `Conversation` document:

1. **Unread count — unconditional atomic increment**, since every distinct persisted message must count exactly once regardless of arrival/completion order relative to other concurrent messages:
   ```js
   Conversation.updateOne(
     { _id: conversationId },
     { $inc: { [`unreadCount.${recipientId}`]: 1 } }
   )
   ```
2. **Last-message preview — conditional atomic set**, guarded so a write that *completes* later doesn't get clobbered by one that was *sent* later but happens to complete first (out-of-order completion under concurrency), and so a message that's actually older never overwrites a newer preview:
   ```js
   Conversation.updateOne(
     { _id: conversationId,
       $or: [
         { lastMessageAt: { $exists: false } },
         { lastMessageAt: { $lt: message.createdAt } }
       ]
     },
     { $set: { lastMessageAt: message.createdAt, lastMessagePreview: previewText } }
   )
   ```
   The `$or` handles a brand-new conversation's first message, where `lastMessageAt` doesn't exist yet — a bare `{ $lt: ... }` would not match a missing field and the first message's preview would never get set.

These are two separate calls (not one combined update) because they have different conditions: the unread increment must **always** apply per distinct message, while the preview/timestamp set must **conditionally** apply only if the message is actually the newest seen so far — combining them under one query filter would incorrectly skip the unread increment for a message that "loses" the preview race. Both are single-document operations, so each is atomic on its own; no transaction is needed. See TESTING.md #26 (duplicate retry) and the existing #19 (now extended — see TESTING.md) for the concurrent-distinct-messages test.

### 13c. Per-Conversation Send Ordering (resolved 2026-08-31)

**Problem:** two rapid `message:send` events from the same sender in the same conversation are delivered to the server's handler in order (Socket.IO preserves per-connection event order), but the handler is `async` — Socket.IO does not wait for one handler's promise to resolve before dispatching the next event, so their `Message.create()` calls can start out of order and, under variable write latency, could theoretically *complete* (and therefore receive their `createdAt`) out of send order.

**Required mechanism (MVP-appropriate — no new infrastructure):** an **in-process, per-`conversationId` promise chain** in the socket layer (e.g. `sockets/message.handlers.js`): a `Map<conversationId, Promise>` where each incoming `message:send` for that conversation is appended to (`await`s) the previous entry before doing its own persist-and-broadcast work, then becomes the new tail of the chain. This guarantees messages for one conversation are persisted in the order their `message:send` events were received by the server, regardless of individual write latency.

**Scope and limitations (must be stated, not glossed over):** this is in-memory and per-process — it only orders events received by *this* Node instance. It does not, and is not intended to, provide any ordering guarantee across multiple server instances; if the app is ever horizontally scaled (ARCHITECTURE.md §17), a client's `message:send` calls for one conversation would need to be routed to the same instance, or this mechanism would need to be replaced by something distributed — explicitly out of scope for the single-instance MVP. It also does not (and does not need to) impose any specific relative order between two *different* senders' concurrent messages in the same conversation beyond "whatever order the server actually received them in" — there is no client-observable "correct" order between two independent humans typing at the same instant. See TESTING.md #28.

### 13d. Ack vs. Broadcast Failure Isolation (resolved 2026-08-31)

`message:send`'s ack reflects **persistence** success or failure only. Once `Message.create()` (and §13b's metadata updates) succeed, the ack is sent (`{ok:true, message}`) *before* attempting the `io.to(`conversation:<id>`).emit('message:new', ...)` broadcast. The broadcast is wrapped in its own `try/catch` that logs on failure but never re-throws into the ack path and never causes the sender to see a failure — the message is already safely durable at that point, and a missed live broadcast is recovered by the existing reconnection/history-sync path (REALTIME.md §19) for any client that didn't receive it live. See REALTIME.md §11/§12 for the updated event-table wording and TESTING.md #29 for the test.

## 14. Data Models

### `User`

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `email` | String | yes | unique, lowercase, indexed |
| `passwordHash` | String | yes | never selected by default (`select: false`) |
| `displayName` | String | yes | 2–50 chars |
| `avatarUrl` | String | no | |
| `statusText` | String | no | e.g. "busy", max 100 chars |
| `lastSeenAt` | Date | no | updated on last-socket disconnect |
| `createdAt` / `updatedAt` | Date | auto | Mongoose timestamps |

**Indexes:** `{email: 1}` unique. Search index on `displayName` (regex-based `^prefix` query against a small user base is sufficient for MVP; a text index is a documented upgrade path if search needs to be fuzzier).
**Constraints:** `email` unique. Password never returned in any serialized response (explicit `toJSON` transform strips `passwordHash`).
**No `tokenVersion` field** — session/refresh-token revocation is per-device via the `Session` model below, not a per-user counter. See §6a for the full multi-device logout design.

### `Session`

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | embedded as the `sid` claim in that session's refresh token |
| `userId` | ObjectId (ref `User`) | yes | indexed |
| `createdAt` | Date | auto | Mongoose timestamp |
| `expiresAt` | Date | yes | `createdAt + 7d`; TTL-indexed for automatic cleanup |

**Indexes:** `{userId: 1}` (logout-all lookup). `{expiresAt: 1}` TTL (`expireAfterSeconds: 0`).
**Purpose:** one document per logged-in device/browser; deleting it revokes that device's refresh token without touching any other device's. Full design and rationale in §6a.

### `Conversation`

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `participants` | [ObjectId] (ref `User`) | yes | exactly 2 in MVP |
| `participantsKey` | String | yes | `[idA, idB].sort().join('_')` — enables the unique index for idempotent creation |
| `lastMessageAt` | Date | no | denormalized, for list sorting |
| `lastMessagePreview` | String | no | denormalized, truncated text of last message |
| `unreadCount` | Map<String, Number> | yes | keyed by userId string, default `{}` |
| `createdAt` / `updatedAt` | Date | auto | |

**Indexes:** `{participantsKey: 1}` unique (idempotency + dedup). `{participants: 1, lastMessageAt: -1}` (list query).
**Relationships:** `participants` references two `User` documents. Not modeling a separate join collection — 2-participant array is sufficient and simpler than a join table for 1-to-1 chat (documented as a decision that changes if/when group chat is added).
**Soft deletion:** out of MVP scope (no conversation deletion at all yet); if added later, an `archivedFor: [userId]` array (per-user archive, not a destructive delete) is the natural extension.

### `Message`

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `conversationId` | ObjectId (ref `Conversation`) | yes | indexed |
| `senderId` | ObjectId (ref `User`) | yes | |
| `text` | String | yes | 1–4000 chars, trimmed, rejected if empty after trim |
| `clientMessageId` | String (UUID) | yes | client-generated, used for idempotent dedup |
| `status` | String enum | yes | `sent` \| `delivered` \| `read`, default `sent` |
| `deliveredAt` | Date | no | |
| `readAt` | Date | no | |
| `createdAt` | Date | auto | authoritative ordering timestamp |

**Indexes:** `{conversationId: 1, createdAt: -1, _id: -1}` (pagination — see §12 for the exact cursor comparison). `{conversationId: 1, clientMessageId: 1}` unique (idempotency/duplicate protection — see REALTIME.md).
**Constraints:** `text` max length enforced both by Zod (pre-persistence, returns a clean 400/ack error) and by the Mongoose schema (`maxlength`, defense in depth).
**Pagination:** always queried with `.limit(n)` and a cursor filter; never `Message.find({conversationId})` unbounded.
**Soft deletion / editing:** out of MVP (messages are immutable once sent); a future `deletedAt`/`editedAt` pair is the natural extension and would need to be reflected in the real-time event contract (an explicit `message:deleted`/`message:edited` event) rather than silently mutating history.
**Status transitions are monotonic (resolved 2026-08-31):** valid transitions are `sent → delivered → read` only; `read` is terminal. Each transition is a **conditional atomic update**, guarding against a late/in-flight event regressing a message backward:
```js
// message:delivered handler — only advances from 'sent'
Message.updateOne({ _id, status: 'sent' }, { $set: { status: 'delivered', deliveredAt } })
// message:read handler — always safe to move to the terminal state from sent or delivered
Message.updateMany({ conversationId, senderId: otherUserId, createdAt: { $lte: cursorMsg.createdAt }, status: { $ne: 'read' } }, { $set: { status: 'read', readAt } })
```
A `message:delivered` event that arrives after the message was already marked `read` matches zero documents (its filter requires `status: 'sent'`) and is a safe no-op — it can never overwrite `read` back to `delivered`. See TESTING.md #30.

## 15. Proposed REST API Endpoints

All routes prefixed `/api`. "Auth" = requires valid `accessToken`. "Authz" = additional per-resource check beyond authentication.

### Auth

**POST `/auth/register`**
- Auth: none. Authz: none.
- Body: `{email, password, displayName}`
- Response: `201 {user}` + sets `accessToken`/`refreshToken` cookies (auto-login after register).
- Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`.

**POST `/auth/login`**
- Auth: none. Authz: none.
- Body: `{email, password}`
- Response: `200 {user}` + sets cookies.
- Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`.

**POST `/auth/refresh`**
- Auth: valid `refreshToken` cookie (not `accessToken`). Authz: none.
- Response: `200` + sets a new `accessToken` cookie.
- Errors: `401 INVALID_REFRESH_TOKEN` (missing/invalid signature, expired, or the token's `sid` no longer matches an existing `Session` document — see §6a).

**POST `/auth/logout`**
- Auth: yes. Authz: none.
- Response: `200`, clears both cookies. Deletes **only the caller's own** `Session` document (by the `sid` in their own refresh token) — does not affect the user's other logged-in devices. See §6a.
- Errors: none beyond auth failure.

**POST `/auth/logout-all`**
- Auth: yes. Authz: none (a user can always revoke all of their own sessions; no other user's data is touched).
- Response: `200`, clears the caller's own cookies. Deletes **every** `Session` document for `req.userId` and disconnects that user's currently-connected sockets (`io.in(`user:<userId>`).disconnectSockets()`) so revocation takes effect immediately rather than waiting for other devices' access tokens to expire. See §6a.
- Errors: none beyond auth failure.

### Users

**GET `/users/me`**
- Auth: yes.
- Response: `200 {user}`.

**PATCH `/users/me`**
- Auth: yes.
- Body: `{displayName?, avatarUrl?, statusText?}`
- Response: `200 {user}`.
- Errors: `400 VALIDATION_ERROR`.

**GET `/users/search?q=<string>`**
- Auth: yes.
- Query: `q` (min 1 char), `limit` (default 20, max 50).
- Response: `200 {users: [...]}` (excludes the requester, minimal public fields only).
- Errors: `400 VALIDATION_ERROR`.

### Conversations

**Response shape (both `POST /conversations` and `GET /conversations`, resolved 2026-09-01 — M3):** a conversation is always serialized from the requester's point of view, never as a raw document:
```json
{
  "_id": "...",
  "otherParticipant": { "_id": "...", "displayName": "...", "avatarUrl": "...", "statusText": "...", "lastSeenAt": "..." },
  "lastMessageAt": null,
  "lastMessagePreview": null,
  "unreadCount": 0,
  "createdAt": "..."
}
```
`unreadCount` is always projected down to the single number for the requester — the underlying `Map<userId, count>` (§14) is never serialized whole, so one participant can never see another's unread count.

**POST `/conversations`**
- Auth: yes. Authz: implicit (creating for self + target only).
- Body: `{participantId}`
- Response: `201 {conversation}` (or `200 {conversation}` if one already existed — idempotent, including under concurrent creation attempts for the same pair; see §13a).
- Errors: `400 VALIDATION_ERROR`, `404 USER_NOT_FOUND` (target doesn't exist), `400 CANNOT_MESSAGE_SELF`.

**GET `/conversations`**
- Auth: yes.
- Query: `cursor?`, `limit` (default 20, max 100).
- Response: `200 {conversations: [...], nextCursor}`, newest-active-first (see the cursor decision at the end of §12).
- Errors: none beyond auth.

**GET `/conversations/:id/messages`**
- Auth: yes. Authz: requester must be a participant.
- Query: `cursor?`, `limit` (default 30, max 100).
- Response: `200 {messages: [...], nextCursor}`.
- Errors: `400 VALIDATION_ERROR` (malformed conversation id or cursor), `403 FORBIDDEN` (not a participant), `404 CONVERSATION_NOT_FOUND`.
- **M3 status:** route, auth, authz, and query-shape validation are fully wired; the handler always returns `{messages: [], nextCursor: null}` since no `Message` document can exist yet (the `Message` model itself is an M5 deliverable — PROJECT_SPEC.md M3 task 7). M6 replaces the body of this handler with the real tuple-cursor query below; the route contract does not change.

**POST `/conversations/:id/read`**
- Auth: yes. Authz: requester must be a participant.
- Body: `{upToMessageId}` (marks all messages up to and including this one as read; mirrors/complements the real-time `message:read` socket event for the case where the client needs a REST fallback, e.g. reconciling on page load before the socket connects).
- Response: `200 {unreadCount: 0}`.
- Errors: `400 VALIDATION_ERROR` (malformed conversation id or `upToMessageId`), `403 FORBIDDEN`, `404 CONVERSATION_NOT_FOUND`.
- **M3 status:** route, auth, authz, and body-shape validation are fully wired; `upToMessageId` is checked for well-formedness only — it isn't looked up, since real read-state mutation lands in M8.

Message *sending* is intentionally **not** a REST endpoint — see §13.

## 16. What's Explicitly Not Implemented Yet

Group conversations, message edit/delete, attachments, push notifications, socket connection-attempt rate limiting (REALTIME.md §25a), and an "active devices" management UI (the `Session` model supports it; no endpoint/UI is built for it beyond `logout-all`) — all deferred per PROJECT_SPEC.md §7. Do not add corresponding endpoints speculatively.
