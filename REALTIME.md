# REALTIME.md — Real-Time Architecture

Related concepts: [[WebSocket]] [[Socket.IO]] [[Rooms]] [[Idempotency]] [[Message Ordering]] [[Reconnection]] [[Presence]] [[Read Receipts]]

> This document is the authoritative contract for every Socket.IO event in the system. No event is implemented before it appears in the table in §7.

## 1. What WebSockets Are

WebSocket is a protocol (RFC 6455) that upgrades a single HTTP connection into a persistent, full-duplex TCP channel: after the initial HTTP handshake (`Upgrade: websocket`), both client and server can send frames to each other at any time, with none of HTTP's per-message request/response overhead (no repeated headers, no new connection per message). This is what makes low-latency, server-initiated push (like "a message just arrived") practical.

## 2. What Socket.IO Provides (beyond raw WebSocket)

- **Automatic fallback** to HTTP long-polling if a WebSocket upgrade fails (restrictive proxies/networks), with the same API either way.
- **Automatic reconnection** with exponential backoff, configurable, on by default.
- **Rooms** — a server-side grouping primitive for broadcasting to a subset of connected sockets without the app manually tracking socket-id lists.
- **Acknowledgements** — a built-in callback pattern so an emitted event can receive a confirmed response, similar in spirit to a request/response call, layered on top of the otherwise fire-and-forget event model.
- **Namespaces** and a structured event-based API (vs. raw WebSocket's single `onmessage` string/binary frame you'd have to parse and route yourself).

## 3. Why Socket.IO Was Selected

**DECISION:** Socket.IO over polling and over raw `ws`.
**WHY:** The app needs low-latency, server-initiated events (new messages, typing, presence) to multiple recipients, with reconnection resilience and a room-based targeting model — all things Socket.IO provides directly instead of requiring hand-rolled infrastructure.
**ALTERNATIVES:** (a) HTTP polling/long-polling built manually; (b) Server-Sent Events (SSE); (c) raw `ws` library.
**TRADEOFF vs. polling:** Polling is simpler (plain REST, no new protocol) but trades latency for simplicity and wastes requests when nothing's new — a bad fit for a chat app's UX bar. **TRADEOFF vs. SSE:** SSE is server→client only; the app needs client→server real-time events too (typing, read receipts), so a bidirectional channel is a better fit and avoids running two separate mechanisms. **TRADEOFF vs. raw `ws`:** raw `ws` is lighter-weight and avoids Socket.IO's protocol framing overhead, but reconnection, rooms, and acknowledgements would all need to be built by hand — meaningful, error-prone infrastructure work for no real gain at this project's scale, and less interview-standard for a MERN stack context.
**INTERVIEW EXPLANATION:** "I chose Socket.IO over raw WebSocket because I needed rooms, acknowledgements, and reconnection handling, and building those correctly by hand is exactly the kind of infrastructure work that's easy to get subtly wrong — Socket.IO gives me a well-tested implementation of primitives I'd otherwise have to build myself, and I can explain exactly what each of those primitives is doing underneath."

## 4. Socket Connection Lifecycle

See ARCHITECTURE.md §12 for the full state diagram. Summary: `connecting → authenticating → connected`, with `disconnected → reconnecting → authenticating` on any drop, and `rejected` if the handshake JWT is missing/invalid.

## 5. Socket Authentication

**Implemented M4** (`backend/src/sockets/index.js`) as Socket.IO middleware (`io.use((socket, next) => {...})`), run once per connection attempt, **before** any event handlers are registered for that socket:

1. Read the JWT from the handshake's raw `Cookie` header (parsed with the `cookie` package — the same `accessToken` cookie REST uses, no separate socket-specific token) and verify it with the exact `verifyAccessToken()` from `utils/tokens.js` the REST `authenticate` middleware also calls — no second auth system.
2. Verify signature + expiry. Failure → `next(err)` with `err.data.code` set to `NO_TOKEN` (missing cookie) or `INVALID_TOKEN` (bad signature or expired, collapsed into one code exactly as REST does), which rejects the handshake (client receives `connect_error`).
3. Success → attach `socket.userId = decoded.sub`, then in the `connection` handler, join the socket to room `user:<userId>` immediately (used for cross-tab/device targeting, §9).

**No socket is ever considered "logged in" independent of this check** — there is no separate socket-level login event; the HTTP-issued cookie *is* the socket credential. If the access token expires while a socket is connected, the socket is **not** forcibly disconnected mid-session (Socket.IO doesn't re-verify per-event by default here) — but every event handler that performs a privileged action re-derives `socket.userId` from the value set at handshake time, which was itself verified; the token's later expiry only affects *future* handshakes (i.e., the next reconnect), which is an accepted, documented tradeoff (see §18 Security concerns).

## 6. Socket Authorization

Identical principle to REST (ARCHITECTURE.md §9): `socket.userId` (server-derived, never client-claimed) is checked against DB participation **on every event that touches a conversation**, specifically:
- Joining `conversation:<id>` (on `conversation:join`): reject if not a participant. **Implemented M4**, reusing `assertParticipant()` from `conversation.service.js` (M3) unchanged — the second consumer of a helper built specifically to be reused this way.
- Sending a message (`message:send`): reject if not a participant of the target `conversationId`. (M5)
- Read receipts / typing events: same check. (M7/M8)

A client can *ask* to join any room name it wants — the server never honors that request without the DB check. This mirrors CLAUDE.md's core rule: never trust a client-supplied `conversationId`/`roomId`.

## 7. Rooms

| Room | Joined when | Purpose |
|---|---|---|
| `user:<userId>` | immediately on connect (every socket) | Targets *all* of a user's tabs/devices at once — used for presence broadcasts to that user's contacts, and as a fallback delivery target. |
| `conversation:<conversationId>` | client emits `conversation:join` for a conversation it has open, server verifies membership | Scopes message/typing/read-receipt broadcast to just the two participants, without the server needing to track "which sockets belong to this conversation" manually. |

**Why both a per-user room and a per-conversation room?** The per-conversation room is the natural broadcast scope for "new message"/"typing" (only the two participants care, and only while at least one has it open). The per-user room is needed independently because presence/unread-count updates must reach a user's *other* open tabs/devices and conversation-list view even when they don't have that specific conversation open — join-per-conversation alone wouldn't cover that. This directly is what makes multi-tab/multi-device consistency work (§14).

**Join/leave race — "latest intent wins" (resolved 2026-08-31):** `conversation:join`'s membership check is async (a DB query); `conversation:leave` is effectively synchronous (`socket.leave(room)` needs no DB check — leaving is always safe). If a client rapidly navigates between conversations (e.g. `join(A)` immediately followed by `leave(A)`, such as opening then quickly closing a chat), the `leave` can execute and complete *before* the still-in-flight `join`'s membership check resolves — without a guard, the join would then call `socket.join()` anyway, leaving the socket in a room the client already asked to leave, silently receiving events for a conversation it's no longer displaying.

**Required mechanism (in-process, no new infrastructure) — implemented M4** in `sockets/conversation.handlers.js`, deliberately split out of `sockets/index.js` (which stays focused on auth/connection lifecycle): track the *last-requested intent* per `(socketId, conversationId)` pair in a small in-memory map (`Map<string, 'join'|'leave'>` keyed by `${socketId}:${conversationId}`, one instance per Socket.IO server, not a module-level singleton — so multiple server instances, e.g. one per test, never leak state into each other). `conversation:leave` sets the intent to `'leave'` and calls `socket.leave()` immediately. `conversation:join` sets the intent to `'join'` immediately (before the async membership check starts), runs the membership check, and — only once it resolves — actually calls `socket.join()` **if and only if** the intent for that pair is still `'join'` at that moment; if a `leave` (or a newer `join` superseding an older in-flight one) has updated the intent in the meantime, the stale join is a no-op. This guarantees the socket's actual room membership always reflects the most recently requested state, never a stale in-flight check winning after the fact. See TESTING.md #27 for the concurrency test.

## 8. User-to-Socket Mapping (Presence)

**Implemented M7** (map itself built in M4, exposed as `io.userSockets`; the presence-handling logic around it — §8's bullets below — is M7). In-memory (single-process, per ARCHITECTURE.md §17): `Map<userId, Set<socketId>>`, maintained in `sockets/presence.js`:
- On connect (post-auth): add `socketId` to `presenceMap.get(userId)` (creating the set if absent). If this is the user's **first** active socket, broadcast `presence:online` to their contacts (see §16 for "contacts" scoping) and clear any `lastSeenAt`.
- On disconnect: remove `socketId` from the set. If the set becomes **empty**, the user has no more active connections — set `User.lastSeenAt = now`, broadcast `presence:offline`.

This map is why presence is accurately "does this user have *any* active tab/device," not "is this specific socket connected." A single dropped socket is never equated with "the user went offline" while another of their sockets is still connected.

## 9. Event Naming Convention

`domain:action`, present-tense for client→server commands, past/noun-state for server→client notifications (e.g. `message:send` command vs. `message:new` notification). All events are listed in §11's table before implementation — no ad hoc events.

## 10. Event Payload Contracts

Every payload is validated server-side with a Zod schema (BACKEND.md §4) before use. Representative shapes:

```ts
// client -> server: conversation:join
{ conversationId: string }

// client -> server: message:send  (ack required)
{ conversationId: string, clientMessageId: string /* uuid */, text: string /* 1-4000 chars */ }

// server -> client: message:new
{
  message: {
    _id: string, conversationId: string, senderId: string,
    text: string, status: "sent", createdAt: string /* ISO */
  }
}

// client -> server: message:delivered
{ conversationId: string, messageId: string }

// client -> server: message:read
{ conversationId: string, upToMessageId: string }

// server -> client: message:status — one of two shapes depending on origin
// (resolved 2026-09-02, M8 — see §17b):
{ conversationId: string, messageId: string, status: "delivered" }       // from message:delivered
{ conversationId: string, upToMessageId: string, status: "read" }        // from message:read (bulk)

// client -> server: typing:start / typing:stop
{ conversationId: string }

// server -> client: typing:update
{ conversationId: string, userId: string, isTyping: boolean }

// server -> client: presence:online / presence:offline
{ userId: string, lastSeenAt?: string /* present on offline */ }
```

## 11. Event Table

| EVENT | DIRECTION | PURPOSE | AUTH | PAYLOAD | ACK | FAILURE BEHAVIOR |
|---|---|---|---|---|---|---|
| `conversation:join` | C→S | Join a conversation's room to receive its live events | required; DB membership re-checked | `{conversationId}` | yes — `{ok, error?}` | **Implemented M4.** Not a participant → ack `{ok:false, error:{code:"FORBIDDEN"}}`, no join. Well-formed but nonexistent id → `{ok:false, error:{code:"CONVERSATION_NOT_FOUND"}}` (corrected from an earlier generic `"NOT_FOUND"` sketch — this reuses `assertParticipant()`'s actual M3 error code unchanged, per BACKEND.md §7). Malformed id → `{ok:false, error:{code:"VALIDATION_ERROR"}}`. |
| `conversation:leave` | C→S | Leave a room (e.g. navigated away) | required | `{conversationId}` | no | **Implemented M4.** No-op if not currently joined. Malformed payload (no ack exists to carry a failure) → a scoped `error` event `{code:"VALIDATION_ERROR", message}` instead, per ARCHITECTURE.md §15's socket error-flow convention. |
| `message:send` | C→S | Persist + broadcast a new message | required; DB membership re-checked | see §10 | **yes** — `{ok, message?, error?}` | **Implemented M5.** Validation fail → ack `{ok:false, error}`. Not participant → `{ok:false, FORBIDDEN}`. Persistence fails → `{ok:false, code:"PERSIST_FAILED"}`, client may retry with same `clientMessageId` (safe, see §13). **Persistence succeeds → ack always `{ok:true, message}`, even if the subsequent broadcast step fails** — see §12a. A duplicate-`clientMessageId` retry acks `{ok:true, message}` for the original message and does not re-broadcast `message:new` (§13's "does nothing else"). |
| `message:new` | S→C | Deliver a newly sent message to the other participant(s) | scoped to room `conversation:<id>` (membership already enforced at join-time) | see §10 | no (fire-and-forget notification; delivery confirmed separately via `message:delivered`) | **Implemented M5.** If recipient offline, or if the broadcast attempt itself throws (§12a), not received live — recovered via reconnection sync (§19) or REST history fetch either way. |
| `message:delivered` | C→S | Recipient's client confirms receipt of a specific message | required; must be a participant of the message's conversation | `{conversationId, messageId}` | no | **Implemented M8.** Silently ignored if message doesn't belong to a conversation the socket is a participant of, or is malformed (logged server-side as a suspicious no-op, not surfaced as an error to avoid leaking existence). **Also a no-op (by design, not by accident) if the message's status is already `delivered` or `read`** — the update is conditioned on `status: 'sent'`, so a delivered event arriving after the message was already read (or a redundant duplicate confirmation) can never regress or re-broadcast. See §17a. |
| `message:read` | C→S | Recipient marks messages read up to a point | required; participant check | `{conversationId, upToMessageId}` | yes — `{ok}` | **Implemented M8.** Invalid `upToMessageId` (not found / not in this conversation) → `{ok:false, error:{code:"VALIDATION_ERROR"}}`. Not a participant → `{ok:false, error:{code:"FORBIDDEN"}}`. A watermark that covers zero newly-unread messages (e.g. a repeat of an already-applied read) is a safe no-op — still acks `{ok:true}`, but touches no `Message` document and doesn't re-broadcast `message:status`. |
| `message:status` | S→C | Notify sender their message's delivery/read state changed | scoped to `user:<senderId>` room | see §10 | no | **Implemented M8.** Reaches every one of the sender's sockets (all tabs/devices — `user:<id>` room, §7). N/A beyond that (pure notification; sender's REST fetch would also reflect the true state, so a missed event self-heals on next load). |
| `typing:start` | C→S | Announce the user started typing | required; participant check | `{conversationId}` | no | **Implemented M7.** Silently dropped if not a participant (no error surfaced — non-critical, non-destructive event). Malformed payload is also silently dropped (same non-critical framing — no `error` event, unlike `conversation:leave`). |
| `typing:stop` | C→S | Announce the user stopped typing | required; participant check | `{conversationId}` | no | **Implemented M7.** Same as above. |
| `typing:update` | S→C | Notify the other participant of typing state | scoped to `conversation:<id>` room, excluding the sender's own sockets | see §10 | no | **Implemented M7.** Exclusion covers *every* socket belonging to the typer (all tabs/devices, via the `user:<id>` room every socket already joins on connect — `.except('user:<id>')`), not just the single emitting socket. Also auto-expires server-side (§15) so a missed `typing:stop` — including one lost to a disconnect — can't wedge the indicator on forever. |
| `presence:online` | S→C | Notify a user's contacts they came online | scoped to each shared-conversation participant's `user:<id>` room | see §10 | no | **Implemented M7.** Fires only on a user's *first* active socket (per-user, not per-socket — §8); a second/third tab or device is a no-op. |
| `presence:offline` | S→C | Notify a user's contacts they went offline, with last-seen | scoped as above | see §10 | no | **Implemented M7.** Fires only when a user's *last* active socket disconnects, at which point `User.lastSeenAt` is also set. Detected for a clean disconnect immediately, and for an abrupt/uncleanly dropped socket via Socket.IO's built-in ping-timeout (§8, TESTING.md #23) — no custom heartbeat logic. |
| `connect_error` | S→C (Socket.IO built-in) | Handshake/auth failure | n/a | Socket.IO error object | n/a | Client treats as "not authenticated," redirects to login or attempts a token refresh then reconnects. |
| `error` | S→C | Structured error for a non-acked failure mid-session | n/a | `{code, message}` | n/a | Client surfaces via the connection-status UI (FRONTEND.md §13) rather than crashing. |

## 12. Message Delivery Flow

See ARCHITECTURE.md §10 for the full sequence diagram. Summary: `message:send` (client, acked) → server validates + persists (`status: sent`) → ack returns the persisted message to the sender → `message:new` broadcast to `conversation:<id>` room → recipient's client (if it has the conversation open/visible) emits `message:delivered` then, once actually viewed, `message:read` → server updates `Message.status` and notifies the sender via `message:status`.

### 12a. Ack Reflects Persistence, Not Broadcast (resolved 2026-08-31)

The ack step and the broadcast step are deliberately decoupled failure domains. Once persistence (and BACKEND.md §13b's conversation-metadata update) succeeds, the ack is sent immediately — **`{ok:true, message}` is never contingent on the subsequent `message:new` broadcast also succeeding.** The broadcast (`io.to(room).emit(...)`) is wrapped in its own `try/catch`; if it throws for any reason, that's logged server-side and nothing else — it never flips the ack to a failure, and it never causes the handler to throw after the ack was already sent. Rationale: the client's only correctness-relevant question is "is my message safely saved," which persistence alone answers; a failed *live* broadcast is not a correctness problem, since any client that missed it recovers the message through the exact same reconnection/history-sync path (§19) already used for offline recipients — there is no separate "broadcast failed" recovery mechanism needed because the durable path already covers it unconditionally. See TESTING.md #29.

## 13. Idempotency & Duplicate-Message Protection

**Problem:** A client might retry `message:send` (e.g. after an ack timeout it can't distinguish from "server never received it" vs. "server received it but the ack was lost") — naively, that produces two persisted messages.
**Solution:** The client generates a `clientMessageId` (UUID v4) **once**, at compose time, and reuses the *same* id on any retry of that same logical send. The server enforces a **unique compound index** on `(conversationId, clientMessageId)` (BACKEND.md §14). The persistence step is an upsert-style operation: if a document with that `(conversationId, clientMessageId)` already exists, the server returns the **existing** persisted message in the ack instead of inserting a second one.
**Result:** Sending is safely retryable any number of times with no duplicate ever reaching the database, regardless of whether the original request actually succeeded silently or not. **Idempotency extends to the message's side effects, not just its existence:** the duplicate-detected retry path returns the existing message and does nothing else — it does not re-run the conversation-metadata update (BACKEND.md §13b), so a retried send never double-increments `unreadCount` or re-touches `lastMessageAt`/`lastMessagePreview` for a message that was already accounted for on the first, successful attempt. See [[Idempotency]] and TESTING.md #26.

## 14. Message Ordering

**DECISION:** Server-assigned `createdAt` (set at the moment of persistence, never trusted from the client) plus `_id` as a tiebreaker is the authoritative order.
**WHY:** Client clocks are unreliable (skew, timezone bugs, deliberate tampering) — never used for ordering. MongoDB `ObjectId`s are themselves roughly time-ordered and monotonically increasing *within a single mongod*, making `_id` a safe, free tiebreaker for two messages with an identical `createdAt` millisecond.
**ALTERNATIVES:** a dedicated per-conversation monotonic sequence counter (incremented atomically per message).
**TRADEOFF:** `(createdAt, _id)` is simpler (no extra counter document/atomic-increment step) and sufficient at this scale; a true sequence counter would guarantee gap-free, strictly-defined ordering even across sharded/clustered MongoDB deployments, which is not a concern for a single-instance MVP.
**INTERVIEW EXPLANATION:** "Ordering is authoritative on the server, using `createdAt` plus `_id` as a tiebreaker — never a client timestamp. If this needed to scale to a sharded cluster I'd introduce a per-conversation sequence counter instead, since ObjectId ordering guarantees weaken across shards." Client-side, both the live `message:new` stream and paginated history use the same sort, so a message is never displayed out of order regardless of whether it arrived live or via a history fetch. See [[Message Ordering]].

**Two further points this decision alone doesn't cover, both resolved 2026-08-31:**
- **Query-level correctness:** "sort by `(createdAt, _id)`" only produces correct pagination if the cursor *comparison* is also a tuple comparison, not just the sort. The exact `$or`-based query for both pagination directions is specified in BACKEND.md §12, precisely because same-millisecond messages (routine under concurrent sends) will silently break a naive `createdAt`-only comparator. See TESTING.md #32.
- **Write-order correctness:** server-assigned `createdAt` is only actually assigned in send order if the persistence calls themselves execute in send order — which isn't automatic for two rapid sends from the same client under `async` handlers. BACKEND.md §13c specifies the per-conversation serialization mechanism that makes this hold. See TESTING.md #28.

## 15. Typing Indicators — Detail

**Implemented M7** (`sockets/typing.handlers.js`).
- Client debounce: `typing:start` fires on first keystroke after >2s idle; `typing:stop` fires after 2s of continued idle, on send, or on blur. (Client-side debounce itself is an M14/frontend concern — not yet built; the server contract below doesn't depend on the client debouncing correctly.)
- **Server-side TTL backstop:** a self-refreshing `setTimeout` per `(conversationId, userId)` typing entry (keyed `${conversationId}:${userId}`, in-memory, never persisted) — each `typing:start` clears and restarts it; the timer firing (no refresh within the window) auto-expires the indicator, emitting a synthetic `typing:update {isTyping:false}` and removing the entry. Default window is 5s in production; the socket server accepts an override (`typingTtlMs`) so tests don't have to wait out the real window. This same mechanism — not a separate on-disconnect hook — is what covers a client disconnecting mid-type and never sending `typing:stop` (TESTING.md #22): the entry simply has nothing to refresh it and expires on schedule either way.

## 16. Presence Events — Detail

**Implemented M7.** Presence broadcasts are scoped to the affected user's **conversation partners only** (found via a `Conversation.find({participants: userId})` query at connect/disconnect time), not globally broadcast to all connected users — bounding fan-out cost and avoiding leaking "who's online" to non-contacts.

## 17. Read Receipts — Detail

**Implemented M8.** `message:read` is sent with `upToMessageId` (not one event per message) so a user opening a conversation with 20 unread messages generates one event, not 20 — the server marks every message in that conversation with `createdAt <= that message's createdAt` (sent by the *other* participant, i.e. only messages the reader received, never their own) as read in a single bulk update (`Message.updateMany`, BACKEND.md §14).

### 17a. Status Transitions Are Monotonic (resolved 2026-08-31, implemented M8)

`sent → delivered → read` only; `read` never regresses. This matters because `message:delivered` and `message:read` can arrive out of their "natural" order — e.g. a recipient reads a message (fast) before their client's `message:delivered` event (sent slightly earlier but delayed in flight) reaches the server. Both handlers use a **conditional atomic update** rather than an unconditional `$set`, so an event that's arrived "too late" is a safe no-op instead of a regression: `message:delivered` only matches (and only advances) a message currently in `status: 'sent'`; a message already at `read` simply doesn't match that filter and is left untouched. Exact update shapes in BACKEND.md §14 (Message model). See TESTING.md #30.

### 17b. `message:status` Has Two Payload Shapes, Not One (resolved 2026-09-02)

**DECISION:** `message:status` carries `{conversationId, messageId, status:"delivered"}` when it originates from `message:delivered` (inherently a single-message event), but `{conversationId, upToMessageId, status:"read"}` — the same watermark shape as the `message:read` request that triggered it — when it originates from a bulk read, rather than one `message:status` event per message covered by the read.
**WHY:** §17's whole point is that reading 20 messages must not generate 20 client→server events; broadcasting 20 server→client `message:status` events right back out for the exact same bulk action would silently reintroduce the same N-events problem on the other side. The reader's client already knows which messages it just marked read (it sent the watermark); the *sender's* client can apply the identical "everything up to X" rule to its own locally-cached sent messages.
**ALTERNATIVES CONSIDERED:** (a) one `message:status{messageId}` event per updated message — simplest mentally, matches the single-message `delivered` case, but reintroduces the N-events problem; (b) `{conversationId, messageIds:[...], status:"read"}` carrying every affected id — avoids the client re-deriving the watermark rule, at the cost of an unbounded-size payload for a very large bulk read.
**TRADEOFF:** The sender's client must apply the same `createdAt <= cursor message's createdAt` rule client-side to reconcile `upToMessageId` against its own message list, instead of just matching on `_id` — a small amount of shared logic between server and client, in exchange for the event staying O(1) in size regardless of how many messages a single read call covers.
**INTERVIEW EXPLANATION:** "The read *request* is already a watermark to avoid one event per message; I kept that same shape on the way back out, otherwise the server-to-client side would have silently reintroduced exactly the problem the request side was designed to avoid."

## 18. Reconnection

Socket.IO's client auto-reconnects with exponential backoff by default; no custom reconnection loop is written. On the `connect` event firing again (which also fires after a reconnect, not just the first connect), the client:
1. Re-authenticates automatically (cookie resent with the new handshake — see §5).
2. Re-joins `conversation:<id>` for whatever conversation is currently open (room membership isn't persisted server-side across a dropped connection — each new connection starts with zero joined rooms besides `user:<id>`, so the client must re-request `conversation:join`).
3. Triggers the sync step (§19) to recover anything missed while disconnected.

## 19. Offline Users & Missed-Message Synchronization

**Implemented M9.** There is no server-side "outbox" queuing events for a disconnected socket — undelivered real-time events are simply **not** re-sent verbatim on reconnect (they were never queued in the first place; Socket.IO does not persist emitted events for offline sockets). Instead, **MongoDB is used as the recovery mechanism**: on reconnect (or on opening a conversation, or on tab focus after being backgrounded), the client fetches anything newer than the last message it has locally via `GET /conversations/:id/messages?after=<lastKnownMessageId>` (BACKEND.md §12's cursor mechanism, run in the opposite/"newer" direction — response `{messages, nextCursor, nextAfter}`, oldest-of-the-missed-batch first, `nextAfter` non-null only if the missed backlog exceeded `limit`). This means the *live event* and the *durable record* are different delivery paths for the same underlying data, and losing the live event is always safe because the durable path fully recovers it. `after` is a raw message id rather than an opaque cursor, and a well-formed but nonexistent/foreign one is a `400 VALIDATION_ERROR`, not a silently empty page — see BACKEND.md §12 for the exact contract. See [[Reconnection]] and TESTING.md #2/#6.

**Sender-side retry after a disconnect-before-ack (task 1/4, TESTING.md #3):** if a client's `message:send` disconnects before the ack arrives, it cannot tell "the server never received it" from "it did, but the ack was lost in the drop" — the safe response is to retry with the *identical* `clientMessageId` once reconnected, which §13's existing unique-index/duplicate-detection path already makes a no-op-beyond-returning-the-original-message. No new server-side mechanism was needed for this — §13's idempotency guarantee, built in M5, already covers a retry that happens to arrive from a brand-new socket connection exactly the same as one from the original connection, since it keys purely on `(conversationId, clientMessageId)`, never on `socket.id`.

**Presence after a server restart (task 5):** `sockets/index.js` builds a fresh, empty `Map<userId, Set<socketId>>` per `createSocketServer()` call (§8) — a new OS process cannot inherit another process's in-memory state, so "the presence map starts empty post-restart" is true by construction, not something requiring a special reset step. What actually needs verifying is that the fresh map's connect/broadcast machinery still behaves correctly once clients reconnect against it, which the real-process-restart harness below exercises directly (a reconnecting user genuinely triggers `presence:online` for a contact who has no stale knowledge of them).

**Real process-restart harness (task 7, TESTING.md #7, resolved 2026-08-31 — replaces the earlier "or simulate" wording):** `tests/integration/server.restart.test.js` spawns `src/server.js` as an actual child OS process (via `node:child_process`), against a real mongod (`mongodb-memory-server`, the same "real MongoDB instance" convention TESTING.md #31 uses), over real HTTP + a real `socket.io-client` connection — never the in-process `createApp()`/`createSocketServer()` helper the rest of the suite uses (`tests/helpers/testServer.js`), since that helper can't exercise "the presence Map has genuinely ceased to exist," only a Socket.IO-level disconnect. It sends a message, kills the process, restarts a new one against the same mongod instance and the same JWT secrets/port, then asserts: (a) the message is still returned by a history fetch, (b) a reconnecting user triggers a genuine `presence:online` for a contact with no stale state, and (c) retrying the pre-crash send with the same `clientMessageId` on the reconnected socket creates no duplicate. Runs as part of the full suite, not gated out of the fast loop, but is deliberately the slowest test in the project (real process spawn + real mongod) — ~2-3s alone.

## 20. Duplicate Messages — Cross-reference

Covered fully in §13. Note this also protects against a *different* duplicate scenario: the same message being delivered twice to the recipient (e.g., once live via `message:new`, once again via a reconnection-triggered history sync racing the live event) — the frontend's message-list cache (FRONTEND.md §8) dedupes by `_id`/`clientMessageId` when merging, so a duplicate *delivery* to the client never becomes a duplicate *render*, independent of the server-side duplicate-*persistence* protection.

## 21. Multiple Tabs

Each tab opens its own Socket.IO connection (its own `socketId`), all mapped to the same `userId` in the presence map (§8) and all members of the same `user:<userId>` room. A message sent from Tab A must still appear in Tab B (same user, same conversation open in both): this is handled because `message:new` is broadcast to the `conversation:<id>` room, which both tabs' sockets have joined if both have that conversation open — **not** by excluding the sender's own sockets (unlike `typing:update`, which does exclude the sender, since a user doesn't need to see their own typing indicator). If only Tab A has the conversation open, Tab B still gets the conversation-list-level update (unread count, last message preview) via the `user:<userId>` room.

## 22. Multiple Devices

Architecturally identical to multiple tabs — a device is just another socket connection for the same `userId`. No device-specific logic exists or is needed; the per-user room abstraction already generalizes across "however many concurrent connections this user happens to have."

## 23. Server Restart

All durable data (users, conversations, messages, their `status`) survives a restart, since it lives entirely in MongoDB. What does **not** survive: the in-memory presence map (§8) — every user appears offline immediately post-restart until their client's Socket.IO auto-reconnect completes and the presence map is rebuilt from scratch. This is a deliberate, documented, accepted limitation for a single-instance MVP (ARCHITECTURE.md §18's decision log) — not a bug, but must be stated as such, not silently glossed over, if asked "what happens on deploy/restart."

## 24. Failure Scenarios — Summary Table

Full scenario-by-scenario expected behavior and test approach lives in TESTING.md's edge-case matrix; this table cross-references which section of this doc governs each:

| Failure | Governed by |
|---|---|
| Sender's ack never arrives | §13 Idempotency (safe retry) |
| Recipient offline at send time | §19 Offline sync |
| Network drops mid-session | §18 Reconnection |
| Server restarts | §23 Server restart |
| Duplicate send attempt | §13 Idempotency (message + BACKEND.md §13b metadata side effects) |
| Client with stale/no conversation room joined | §18 step 2 (re-join on reconnect) |
| Typing indicator sender disconnects mid-type | §15 server-side TTL |
| Persistence succeeds, live broadcast fails | §12a Ack vs. broadcast isolation |
| `message:delivered` arrives after `message:read` | §17a Monotonic status transitions |
| Concurrent conversation creation | BACKEND.md §13a |
| Concurrent/rapid same-sender sends | BACKEND.md §13c |
| Overlapping `conversation:join`/`leave` | §7 "Latest intent wins" |
| Same-millisecond pagination boundary | BACKEND.md §12 exact cursor comparison |
| Logout on one device vs. all devices | BACKEND.md §6a Session model |

## 25. Rate Limiting

`message:send` is rate-limited **per authenticated `userId`** (not per-socket, so multi-tab spam from the same user is also bounded) using a simple in-memory token bucket in `sockets/presence.js`-adjacent state: capacity 20, refill 2/sec. Exceeding it does not disconnect the socket — the ack returns `{ok:false, error:{code:"RATE_LIMITED"}}`, and the client surfaces this distinctly from a persistence failure (retry-worthy vs. "slow down"). This is the single authoritative description of this limit — BACKEND.md §10 cross-references here rather than restating the parameters.

### 25a. Connection-Attempt Rate Limiting — Intentionally Deferred (resolved 2026-08-31)

**Decision:** no rate limit or cap on Socket.IO *handshake attempts* (as opposed to `message:send`, which is limited once connected) exists in MVP scope.
**Why deferred, not just forgotten:** this is a personal, single-instance interview-prep project, not a publicly deployed product under active abuse — the realistic threat model doesn't currently include a motivated attacker flooding connection attempts. Message-send is the one long-running abuse surface a legitimate authenticated user could actually hit by accident (a buggy client retry loop, say), which is why *that* has a limiter. Adding connection-attempt throttling now would be exactly the kind of infrastructure CLAUDE.md §2 says not to build ahead of an actual need.
**If this ever becomes required:** the smallest fix is a per-IP counter (e.g. `express-rate-limit` applied to the Socket.IO handshake's underlying HTTP upgrade request, or a small in-memory `Map<ip, count>` in the `io.use()` auth middleware) — no new service, no distributed store, consistent with every other rate limit in this project.
**Status:** documented in PROJECT_SPEC.md §7 (Future Scope) as a known, deliberate limitation — not silently absent.

## 26. Security Concerns Specific to Real-Time

- A long-lived socket connection means a token verified at handshake time is trusted for the connection's *entire* lifetime (§5) — acceptable given the 15-minute access-token expiry keeps the exposure window small, but explicitly documented as a tradeoff (a compromised-but-not-yet-expired token remains usable over an already-open socket even after, say, a password change). Handshake verification stays fully stateless — no DB check is added at handshake time for this. The mitigation is instead an **active** one: the `/auth/logout-all` flow (BACKEND.md §6a) deletes every `Session` document for that user *and* proactively disconnects their currently-connected sockets via `io.in(`user:<id>`).disconnectSockets()`, so a "logout everywhere"/password-change response takes effect immediately rather than waiting for open sockets' access tokens to expire naturally. An ordinary single-device logout does neither of these things — it only deletes that one device's `Session`, and deliberately does not touch other devices' sockets or sessions (BACKEND.md §6a).
- Every event handler independently re-validates payload shape and re-checks DB membership — a compromised/rejected `conversation:join` never implicitly grants trust to a later event for the same room.
- Message content is never trusted as safe HTML at any layer — enforced by rendering as plain text on the frontend (FRONTEND.md), independent of any server-side sanitization, so even a hypothetical validation gap can't become a stored-XSS vector.

## 27. Horizontal Scaling Considerations

Covered in ARCHITECTURE.md §17 (Redis adapter for cross-instance room broadcast, shared presence store). Not implemented in MVP.
