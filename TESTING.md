# TESTING.md — Testing Strategy

Related concepts: [[Idempotency]] [[Message Ordering]] [[Reconnection]] [[Authorization]]

> Written before implementation, per CLAUDE.md §13. No feature is "done" until its relevant rows in §9's matrix are covered.

## 1. Testing Philosophy

- **Test behavior, not implementation.** Tests assert on observable outcomes (HTTP response, emitted socket event, DB state) not internal function call counts.
- **Edge cases are first-class, not an afterthought.** A feature isn't complete when the happy path works; it's complete when §9's relevant rows are handled and verified.
- **Reliability and security features are tested adversarially**, not just for the intended-use path — e.g., authorization tests always include "what if the caller isn't a participant," not just "what if they are."
- **Prefer integration tests over heavily-mocked unit tests for anything touching MongoDB or Socket.IO** — a mocked Mongoose call can pass while the real query is subtly wrong (bad index assumption, wrong filter shape); an in-memory MongoDB instance (`mongodb-memory-server`) gives real query behavior without needing a live external database.
- **No feature is marked done in PROJECT_SPEC.md's checklist without its tests passing.**

## 2. Unit Testing

Scope: pure functions and isolated logic with no DB/socket dependency — token signing/verification helpers, Zod schema validation, the idempotent-cursor encode/decode helpers, the typing-indicator debounce/TTL calculation, rate-limit token-bucket logic.
Tooling: Vitest (fast, Vite-native, consistent tooling across frontend/backend).

## 3. Integration Testing (Backend)

Scope: service-layer functions against a real (in-memory) MongoDB instance — e.g., "creating a conversation between the same two users twice returns the same document," "paginating messages returns the correct cursor and stops at the boundary," "the unique `(conversationId, clientMessageId)` index actually rejects/dedupes a duplicate insert."
Tooling: Vitest + `mongodb-memory-server` + Mongoose.

## 4. API Testing

Scope: full REST request → middleware → controller → service → DB → response, via `supertest` against the real Express app (with the in-memory Mongo instance). Every endpoint in BACKEND.md §15 gets at least: one authenticated-success test, one unauthenticated (401) test, and one authorization-boundary test where relevant (§9 rows 9–12).

## 5. Socket Testing

Scope: connect a real `socket.io-client` against a real (locally-started) Socket.IO server instance backed by the in-memory Mongo, for each event in REALTIME.md §11 — asserting on: the ack payload, any broadcast event received by a second connected client, and resulting DB state. Explicitly includes negative cases: malformed payload, non-participant sender, duplicate `clientMessageId`, and the rate-limit boundary.

## 6. Frontend Testing

Scope: component and hook-level tests (React Testing Library + Vitest) for the pieces with real logic — the optimistic-send reconciliation in the messages query cache, the reconnection sync trigger, the typing debounce, the read-on-visible logic, the API client's refresh-and-retry-once behavior. Rendering-only components are covered lightly (smoke tests), not exhaustively — effort goes where the logic is.

## 7. End-to-End Testing

Scope: a small number of high-value flows exercised in a real browser against a real running backend + real MongoDB (test instance) — not a replacement for the layers above, a check that they're wired together correctly:
1. Register → login → search for a second (seeded) user → start a conversation → send a message → see it appear.
2. Two browser contexts (simulating two users) — send from one, verify live receipt + read receipt in the other.
3. Kill the network on one context mid-session, restore it, verify reconnection + message sync recovers correctly.
Tooling: Playwright (multi-context support fits the two-user flows directly).

## 8. Security Testing

- Authorization boundary tests (§9 rows 9–11) run for *every* conversation/message-touching REST route and socket event, not a sampled subset.
- Input validation tests include boundary and malicious-shape input: oversized payloads, wrong types, extra/unexpected fields, NoSQL-injection-shaped strings in query params (e.g. `{"$gt": ""}` style objects where a string is expected — confirms Zod's type checking, not just presence checking, rejects them).
- A rendering test confirms a message containing `<script>`/HTML-like content is displayed as inert text, never executed or injected as HTML (XSS-safe rendering check, FRONTEND.md).
- Rate-limit tests confirm both the auth endpoints and `message:send` actually reject/throttle beyond their documented thresholds (BACKEND.md §10, REALTIME.md §25).
- Cookie tests confirm `accessToken`/`refreshToken` are set `httpOnly`, `Secure` (in production config), and with the intended `SameSite` value.

## 9. Failure Testing

Scope: deliberately inject failure — simulate a DB write rejection mid-request (integration test with a mocked Mongoose method throwing) and confirm the ack/response reports failure cleanly rather than hanging or crashing the process; kill and restart the test Socket.IO server mid-suite and confirm reconnection recovers full state per REALTIME.md §23 (case #7 — a real child-process restart, not a simulated one); stop and restart the in-memory MongoDB instance mid-suite to exercise a sustained outage and recovery, not just a single failed call (case #31). Also includes the concurrency/race scenarios added in the pre-implementation audit (cases #26–29, #33) — these are "failure" in the sense of a race that *would* corrupt state if the atomic-update/serialization/idempotency mechanisms weren't in place, verified by deliberately provoking the race (concurrent calls, mocked latency, mocked throws) rather than hoping it doesn't happen in CI.

## 10. Edge-Case Matrix

For every case: **SCENARIO → EXPECTED BEHAVIOR → HOW WE TEST IT**

**1. Receiver online**
→ Message delivered live via `message:new`, status progresses to `delivered` shortly after.
→ Socket test: two connected clients, assert second client receives `message:new` within the test timeout and DB `status` updates.

**2. Receiver offline**
→ Message persists with `status: sent`; delivered/read only after receiver's next connect + history sync.
→ Socket test: only sender connected; assert ack succeeds and DB state is `sent`; then connect the "receiver," call the history endpoint, assert the message is present.

**3. Sender disconnects (mid-send, before ack)**
→ On reconnect, client retries `message:send` with the *same* `clientMessageId`; server returns the existing persisted message, no duplicate.
→ Socket test: emit `message:send`, disconnect before the ack listener fires (simulated), reconnect, re-emit identical payload, assert exactly one `Message` document exists.

**4. Receiver disconnects (mid-session)**
→ Presence flips to offline (once their last socket drops) and `lastSeenAt` is set; any message sent after this point behaves as case 2.
→ Socket test: connect+disconnect the receiver's socket, assert a `presence:offline` broadcast fires to the sender (who shares a conversation) with a `lastSeenAt`.

**5. Network interruption**
→ Socket.IO's client detects the drop and enters its reconnecting state; UI shows "Reconnecting…" (FRONTEND.md §13); no message is lost (durable path unaffected).
→ E2E test (Playwright): use browser context network offline/online toggling, assert UI state transitions and eventual recovery.

**6. Reconnection**
→ Client re-authenticates, re-joins the active conversation's room, and runs the `after`-cursor sync; any messages sent while disconnected appear, in correct order, without duplicates. The sync's cursor comparison uses the exact `(createdAt, _id)` tuple (BACKEND.md §12) — see #32 for the same-millisecond boundary case this depends on.
→ Socket + API integration test: disconnect, insert a message via a second client while "offline," reconnect, assert the sync fetch returns exactly the missed message(s).

**7. Server restart**
→ All durable data intact post-restart (verified against real MongoDB); presence resets to "all offline" until clients reconnect (documented, not a bug); reconnecting clients sync correctly with no duplicate messages.
→ **Strengthened 2026-08-31 — the "or simulate" escape hatch is removed; this must exercise a real process restart, not a stand-in.** Integration test: spawn the server as an actual child process, connect a real `socket.io-client`, send and confirm a message, kill the child process, restart it, reconnect the client. Assert: (a) the earlier message is still returned by a history fetch, (b) the presence map starts empty (all users appear offline until they reconnect), (c) the reconnecting client's sync produces no duplicate messages. Runs as part of the full CI suite (M17), not the fast per-save loop, since spawning a real process is slower than the rest of this suite — that's a runtime-cost tradeoff, not a scope reduction of what's verified.

**8. Duplicate message submission**
→ Exactly one persisted `Message` regardless of retry count, per the `(conversationId, clientMessageId)` unique index. **Extended 2026-08-31:** the retry's side effects are also idempotent — `unreadCount` is not incremented a second time, and `lastMessageAt`/`lastMessagePreview` are not re-touched (BACKEND.md §13b), since the duplicate-detected branch does nothing beyond returning the existing message.
→ Integration test: call the persistence service twice with an identical payload, assert one document, both calls return the same `_id`. **Additionally assert** `Conversation.unreadCount` for the recipient reflects exactly one increment (not two) after both calls.

**9. Unauthorized conversation access**
→ `403 FORBIDDEN` (REST) / ack `{ok:false, FORBIDDEN}` (socket) for a user who isn't a participant, even with a syntactically valid conversation id. **A non-participant CAN distinguish this (403) from a nonexistent conversation (404) — this is an intentional, documented tradeoff (ARCHITECTURE.md §16), not an oversight**, accepted because `ObjectId`s are unguessable/non-sequential.
→ API + socket test: create a conversation between users A/B, attempt to fetch/join/message as user C, assert rejection and confirm no data returned (no partial leak).

**10. Fake userId**
→ A client cannot act as another user by sending a different `userId` in a payload — the server always uses `socket.userId`/`req.userId` derived from the verified JWT, never a client-supplied field, for any identity-bearing operation.
→ Unit/integration test: craft a `message:send`/request payload including a spoofed `senderId`/`userId` field, assert the persisted/attributed sender is still the authenticated caller, not the spoofed value.

**11. Unauthorized room join**
→ `conversation:join` for a room the caller isn't a participant of is rejected via ack, and the socket is never actually added to that room (verify no broadcast leak).
→ Socket test: attempt `conversation:join` as a non-participant, assert ack failure, then have a legitimate participant send a message and assert the non-participant's client never receives `message:new`.

**12. Invalid conversation ID**
→ Malformed (non-ObjectId) or non-existent id → `400`/`404` (REST) or ack error (socket), never a 500 or unhandled exception.
→ API + socket test: pass a garbage string and a well-formed-but-nonexistent ObjectId, assert both are handled cleanly with distinct, correct error codes.

**13. Invalid message**
→ Non-string `text`, missing `conversationId`, wrong types → rejected by Zod validation before touching the DB, ack `{ok:false, VALIDATION_ERROR}`.
→ Unit test on the Zod schema directly + a socket-level test confirming the handler never reaches the persistence step.

**14. Empty message**
→ Empty string or whitespace-only `text` (after trim) rejected server-side, independent of any frontend disabling of the send button.
→ Unit test on schema (min-length-after-trim rule) + socket test sending `"   "` directly, bypassing the UI.

**15. Excessively large message**
→ `text` beyond 4000 chars rejected with a clear `VALIDATION_ERROR`, both by Zod and the Mongoose `maxlength` as defense in depth.
→ Unit test at the boundary (4000 = ok, 4001 = rejected) + integration test confirming Mongoose would also reject if a validation bypass were somehow attempted.

**16. Message spam**
→ Beyond the rate-limit threshold (REALTIME.md §25, the single authoritative source for the exact capacity/refill parameters), further `message:send` calls are rejected with `RATE_LIMITED` rather than silently dropped or crashing the server; legitimate traffic below the threshold is unaffected. (Socket **connection-attempt** flooding, as opposed to message-send flooding, is a separate, intentionally deferred concern — REALTIME.md §25a.)
→ Socket test: emit sends in a tight loop past the bucket capacity, assert the expected mix of `ok:true`/`RATE_LIMITED` acks and that the bucket refills correctly after the refill window.

**17. Multiple browser tabs**
→ A message sent in one tab appears in another tab of the same user with the same conversation open, with no duplicate render and correct read/unread state shared across tabs.
→ E2E test: two Playwright pages sharing the same authenticated browser context, assert both reflect a message sent in either.

**18. Multiple devices**
→ Same guarantee as multiple tabs, verified via two independent socket connections authenticated as the same user (simulating separate devices rather than same-browser tabs). **On the auth side specifically:** each device holds its own `Session` (BACKEND.md §6a) — see #33 for the logout-isolation guarantee this depends on.
→ Socket test: two `socket.io-client` connections with the same auth cookie, assert both receive `user:<id>`-room-scoped events (e.g. presence/unread updates) consistently.

**19. Simultaneous messages**
→ Both participants sending at (nearly) the same instant results in both messages persisted, correctly ordered relative to each other by server timestamp/`_id`, no lost update. **Extended 2026-08-31:** the cascading `Conversation.unreadCount` increments for both messages must also both apply — no lost update on the metadata side, not just the `Message` documents (BACKEND.md §13b's atomic `$inc`).
→ Integration test: fire two `message:send` calls concurrently (`Promise.all`) from both participants, assert two documents exist with a well-defined relative order, **and assert `unreadCount` for each recipient reflects exactly one increment per message received (no lost update).**

**20. Message ordering**
→ Messages always render in server-assigned `(createdAt, _id)` order across both the live stream and paginated history, regardless of network arrival order. This depends on two distinct guarantees, both now explicit: the **query** uses the exact tuple comparison (see #32), and **write order** for rapid same-sender sends is preserved by the per-conversation serialization queue (see #28) — ordering was previously described only as a sort-order decision without either of these.
→ Integration test: insert messages with deliberately out-of-arrival-order mock timestamps isn't applicable (server assigns `createdAt`) — instead, test that a live `message:new` arriving before a slower-completing earlier send still results in correct final render order once both are reconciled in the query cache (frontend test) and that the paginated history endpoint's sort is stable and correct (backend test).

**21. Read receipt race conditions**
→ Two near-simultaneous `message:read` calls (e.g. from two tabs) for overlapping `upToMessageId` ranges converge to the correct final state (no "un-reading" a message, no lost read update) — the bulk update is expressed as "set read for everything up to X," which is naturally idempotent/commutative for increasing X. **A related but distinct race — a late `message:delivered` arriving after `message:read` — is covered separately as #30, since that's a different event pair racing, not two `message:read` calls.**
→ Integration test: fire two `message:read` calls with different `upToMessageId` values concurrently, assert the final state matches the *later* (higher) one regardless of arrival order.

**22. Typing indicator disconnect**
→ If a typing user disconnects without sending `typing:stop`, the indicator doesn't stay stuck — the server-side TTL (REALTIME.md §15) expires it within the documented window.
→ Socket test: emit `typing:start`, then forcibly disconnect without `typing:stop`, assert a synthetic `typing:update {isTyping:false}` fires within the TTL window.

**23. Stale presence**
→ A socket that drops uncleanly (e.g. process killed, no graceful disconnect frame) is still detected via Socket.IO's built-in heartbeat/ping-timeout, and presence correctly flips to offline rather than remaining stuck "online" indefinitely.
→ Socket test: simulate an abrupt disconnect (destroy the underlying transport without a clean close) and assert presence eventually transitions to offline within the ping-timeout window.

**24. Database failure**
→ A MongoDB write failure during message persistence results in a clean `ok:false` ack (never a hung request or crashed process); a read failure results in a clean 5xx with no partial/corrupt response. **This covers a single failed operation — a sustained outage and its recovery is a distinct scenario, covered separately as #31 (it needs a bounded-timeout guarantee this single-failure test doesn't exercise).** **Extended M18:** `GET /api/health/ready` reports `503` while MongoDB has never connected/is unreachable, distinct from `GET /api/health` (liveness), which stays `200` regardless — an orchestrator's "stop routing here" signal, not its "restart this process" one.
→ Integration test: mock the Mongoose model method to reject, assert the service/controller/socket-handler layer catches it and returns the documented failure shape. **M18 addition:** `tests/integration/health.test.js` asserts `/api/health/ready` is `503` with no DB connection and `200` once one exists, while `/api/health` stays `200` throughout.

**25. Socket connection failure**
→ A failed/rejected handshake (bad or missing token) results in a `connect_error` the client can distinguish from a network-level failure, and the client responds by attempting a token refresh + reconnect rather than looping forever on a doomed handshake.
→ Socket test: connect with an expired/invalid token, assert `connect_error` fires with the expected reason; frontend test: assert the client's handler attempts exactly one refresh-then-reconnect cycle, not an infinite loop.

---

**Cases 26–33 added 2026-08-31**, from the pre-implementation failure/concurrency audit (independent of the original 25, which came from the initial testing-strategy draft). Same SCENARIO → EXPECTED BEHAVIOR → HOW WE TEST IT format.

**26. Concurrent conversation creation**
→ Two `POST /conversations` calls for the same participant pair, fired at nearly the same instant, both succeed from the caller's perspective and both resolve to the *same* `Conversation` document — never a 500 from the losing request's duplicate-key error (BACKEND.md §13a).
→ Integration test: fire two `POST /conversations` calls for the same pair via `Promise.all`, assert exactly one `Conversation` document exists in the database and both HTTP responses return that same `_id`.

**27. `conversation:join`/`leave` race**
→ A `conversation:leave` that completes while an earlier `conversation:join`'s async membership check is still in flight is not overridden by that stale join once it resolves — "latest intent wins" (REALTIME.md §7).
→ Socket test: mock/delay the membership-check call so it doesn't resolve immediately; emit `join` then, before the mock resolves, emit `leave`; let the mock resolve; assert the socket is NOT in the conversation room. Mirror test for join-after-leave superseding an in-flight leave-adjacent join.

**28. Rapid same-sender concurrent sends**
→ Two `message:send` events from the same sender in the same conversation, sent back-to-back, persist with `createdAt` values in the order they were *sent*, even if their underlying DB writes would otherwise complete out of order (BACKEND.md §13c).
→ Integration test: mock the persistence call so the first send's write is artificially delayed past the second's completion; emit both in send order; assert the persisted documents' `createdAt`/insertion order still matches send order, not completion order.

**29. Persistence succeeds, live broadcast fails**
→ If `Message.create()` (and the conversation-metadata update) succeed but the subsequent `io.to(room).emit('message:new', ...)` throws, the sender's ack is still `{ok:true, message}` — a broadcast failure never downgrades an already-successful persistence into a reported failure (REALTIME.md §12a).
→ Socket test: mock `io.to().emit` to throw for one call, send a message, assert the ack is `{ok:true, message}` despite the mocked broadcast failure; assert the message is queryable via history fetch afterward (recovered through the durable path, not the broadcast).

**30. `message:delivered` arrives after `message:read`**
→ A message already marked `read` is never regressed back to `delivered` by a late/in-flight `message:delivered` event — the conditional update (`status: 'sent'` guard) makes this a safe no-op (BACKEND.md §14, REALTIME.md §17a).
→ Integration test: create a message, mark it `read` directly (simulating a fast reader), then emit `message:delivered` for it; assert the message's status is still `read` afterward, not regressed to `delivered`.

**31. Sustained database outage + recovery**
→ While MongoDB is unavailable, in-flight and new requests fail cleanly within a bounded time (`serverSelectionTimeoutMS`, BACKEND.md §12) rather than hanging; once MongoDB becomes available again, subsequent requests succeed without an app restart. This validates recovery within what Mongoose's own reconnection behavior actually provides — not a claim of zero-downtime failover, which this architecture doesn't attempt.
→ Integration test (`mongodb-memory-server`): stop the in-memory Mongo instance, fire several requests during the outage and assert each fails with a clean 5xx within the configured timeout window (not a hang), restart the Mongo instance, fire requests again and assert they succeed normally.

**32. Same-millisecond pagination/cursor boundary**
→ Two messages sharing the exact same millisecond `createdAt` are handled correctly by the compound `(createdAt, _id)` tuple comparison (BACKEND.md §12) in both pagination directions — neither skipped nor duplicated when a cursor sits exactly on one of them.
→ Integration test: insert two messages with an explicitly identical `createdAt` (bypassing normal auto-generation to force the collision), position a cursor at `(that createdAt, one of the two _ids)`, fetch the next page in both the "older" and "newer" directions, assert the other message appears exactly once in each.

**33. Logout on one device vs. all devices**
→ Logging out on one device deletes only that device's `Session` and does not invalidate any other device's refresh token; `POST /auth/logout-all` deletes every session for the user and disconnects their live sockets immediately (BACKEND.md §6a).
→ Integration test: log in twice (two `Session` documents, two refresh-token cookies simulating two devices), log out via device A's cookie, assert device B's refresh token still successfully refreshes. Separate test: call `POST /auth/logout-all` from either device, assert both devices' refresh tokens are now rejected and any connected sockets for that user are disconnected.

---

## 11. Matrix Reconciliation Status (M17, closed 2026-09-05)

Every row of §10's matrix (cases 1–33) has a passing automated test, per CLAUDE.md §16's "never silently skip an edge case" rule — none deferred. Cases 1, 4, 8–16, 18–33 were already covered by their owning milestone's own test suite (M2–M10, cited inline above); M17's own additions closed the remainder:

- **#5 (network interruption) and #6 (reconnection), client-visible half:** the backend-side guarantees were already covered (socket.reconnection.test.js), but the client-visible "Reconnecting…" UI transition and the browser-side resync trigger had no test anywhere until M17 added `frontend/tests/useSocketConnection.test.jsx` (hook-level: the after-cursor fetch/merge itself, matching this section's own §6 scope note) and `e2e/tests/reconnection.spec.js` (a real dropped-and-restored network, real Socket.IO reconnect, real UI).
- **#17/#18 (multiple tabs/devices), UI half:** PROJECT_SPEC.md's M14/M15 acceptance criteria named an E2E test for this that didn't exist yet — `e2e/tests/multi-tab.spec.js` closes it (two pages, one browser context, one user).
- **§7's three E2E flows** (register→search→converse; two-context live delivery + read receipts; offline/reconnect recovery) — none of these had any E2E tooling at all before M17; see §12 below for the harness that now runs them.
- **§8's XSS-safe-rendering rendering test** — named explicitly in this document since the initial draft but never actually written; `frontend/tests/MessageBubble.test.jsx` closes it (PROJECT_SPEC.md §18's matching checklist row is now ticked).

## 12. E2E Harness (M17)

Playwright, per §7's original tooling choice — added only now because M17 is the first milestone whose scope actually requires it (CLAUDE.md §16: no dependency introduced before it's needed). Lives in a new top-level `e2e/` package (sibling to `backend/`/`frontend/`, its own `package.json`) rather than inside `frontend/`, since it drives both halves of the app as external black boxes rather than being frontend code itself.

`e2e/support/backendServer.mjs` is the process Playwright's `webServer` config starts and stops: it boots a real, ephemeral MongoDB (`mongodb-memory-server`, the same real-instance convention `tests/helpers/mongoMemory.js` already uses backend-side) and spawns `backend/src/server.js` as a real child process against it — never a mock of either. The frontend half runs as the real `vite` dev server (not a production build) on a separate fixed port, so `frontend/vite.config.js`'s existing `/api`/`/socket.io` dev-proxy (already hardcoded to `localhost:5000`) needs no changes. Both processes are fresh per test run (`reuseExistingServer: false`) so no run starts with another run's leftover data — determinism over speed, consistent with this document's "keep tests deterministic" principle. Runs single-worker/non-parallel since every spec shares one backend + one database (specs use uniquely-generated emails so they never collide with each other's data, but running them concurrently against the same process would defeat the determinism goal regardless).

Chromium-only (no cross-browser matrix): this suite's goal is verifying the layers are wired together correctly end-to-end, not cross-browser rendering fidelity — a deliberate scope tradeoff, not an oversight.

**Known characteristic, not a bug:** `reconnection.spec.js` simulates a dropped connection via Playwright's `context.setOffline()` (browser-level network emulation), not a server-side kill. Depending on whether Chromium's offline emulation closes the live WebSocket transport promptly, Socket.IO's client falls back to detecting the drop via its ping-timeout heartbeat (defaults: 25s interval / 20s timeout, unconfigured in `backend/src/sockets/index.js`) — so this one spec's runtime varies between roughly 3s and 50s across runs. The test's timeouts are sized for the slow case rather than tuned to the common one, per "avoid brittle timing-based assertions."

## 13. Deployment/Readiness Testing (M18)

New coverage added for M18's own acceptance criteria (ARCHITECTURE.md §19 has the full deployment writeup):

- `tests/integration/health.test.js` — `/api/health/ready` is `503` before any MongoDB connection exists and `200` once one does, while `/api/health` (liveness) stays `200` throughout (#24, extended above).
- `tests/integration/env.production.test.js` — spawns `config/env.js` in a real child process (its validation runs, and can `process.exit(1)`, as an import-time side effect, so this needs a real process the same way `server.restart.test.js` does): boot refuses with `NODE_ENV=production` and no `CLIENT_ORIGIN`; boots normally once it's set; dev's no-`CLIENT_ORIGIN` default behavior is unchanged.
- `tests/integration/logging.security.test.js` — the named "test confirming sensitive fields never appear in log output": spies on `console.log`/`console.error`/`console.warn` across register, login, and a failed login, and separately across a request that reaches `errorHandler.js`'s unexpected-error branch, asserting neither the submitted password nor either JWT signing secret ever appears. `morgan`'s own output isn't dynamically exercised here (it's deliberately silenced under `NODE_ENV=test`) — audited statically instead: both formats in use (`combined`/`dev`) are morgan's own built-ins, which log method/path/status/response-time/user-agent only, never a body, cookie, or Authorization header, by construction.
- `tests/integration/cors.test.js` — confirms the CORS config never reflects a foreign `Origin` header back (the actual vulnerable pattern this class of misconfiguration risks) and never emits a wildcard `*`; the configured `CLIENT_ORIGIN` is always the fixed value returned regardless of the request's own origin, which is how a static-origin `cors()` config is supposed to behave — browser-side same-origin enforcement, not server-side origin matching, is what actually blocks a foreign page from reading a mismatched response.
- **Live-only, not automated (documented, not deferred):** a real production-mode process was booted locally (real env validation, real MongoDB, real cookies/JWTs, a real Socket.IO handshake, the built frontend served and SPA-fallback-routed correctly, graceful shutdown and the uncaught-exception fail-fast path both triggered directly) — see ARCHITECTURE.md §19 and PROJECT_SPEC.md M18's as-built note for the full list of what was checked and the one thing (real cross-process `SIGTERM`/`SIGINT` delivery) that is a Windows-dev-environment limitation, not something this app's code controls.
