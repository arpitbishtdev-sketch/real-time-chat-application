# FRONTEND.md — Frontend Architecture

Related concepts: [[REST API]] [[Socket.IO]] [[Authentication]] [[Presence]] [[Read Receipts]]

> M11 (app shell, routing, design tokens, base components), M12 (authentication UI, auth state) and M13 (conversation list, user search, "start conversation," non-live message history — §7/§8's REST-backed reads and writes, no sockets yet) are implemented per this document. Everything else described here (live socket integration, presence/typing/read-receipt UI, optimistic send) remains architecture-only until its corresponding milestone (M14+) lands.

## 1. Folder Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.js          # fetch wrapper: base URL, credentials:'include', 401->refresh->retry
│   │   ├── auth.api.js
│   │   ├── users.api.js
│   │   └── conversations.api.js
│   ├── sockets/
│   │   ├── socketClient.js    # single socket.io-client instance, connect/disconnect lifecycle
│   │   └── socketEvents.js    # typed emit/on helpers matching REALTIME.md's event table
│   ├── store/
│   │   ├── authStore.js       # zustand: current user, auth status
│   │   ├── presenceStore.js   # zustand: onlineUserIds, lastSeen map
│   │   └── typingStore.js     # zustand: typing state per conversation
│   ├── queries/                # TanStack Query hooks (server state)
│   │   ├── useConversations.js
│   │   ├── useMessages.js
│   │   └── useUserSearch.js
│   ├── components/
│   │   ├── layout/
│   │   ├── conversation/       # ConversationsPane (list/search mode switch), ConversationList,
│   │   │                       # ConversationListItem, NewConversationPanel
│   │   ├── chat/                # ActiveConversation, ChatHeader, MessageList, MessageBubble,
│   │   │                       # MessageInput, TypingIndicator (M14+)
│   │   └── presence/            # PresenceDot, LastSeenLabel
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── RegisterPage.jsx
│   │   ├── ChatPage.jsx
│   │   └── ProfilePage.jsx
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useDebouncedValue.js
│   │   └── useSocketConnection.js
│   ├── utils/                   # authValidation.js, apiErrors.js, formatTime.js, messages.js
│   ├── routes/
│   │   └── AppRouter.jsx
│   └── App.jsx
└── tests/
```

## 2. Routing

**Decision: React Router.**
- `/login`, `/register` — public.
- `/` (chat shell: conversation list + active conversation pane), `/profile` — protected, wrapped in a `<RequireAuth>` route guard that checks `authStore` and redirects to `/login` if unauthenticated.
- Conversation selection is a route param (`/conversations/:id`) so a specific chat is linkable/refreshable, not just client-side-only state.

## 3. Component Architecture

Thin presentational components, logic lifted into hooks/queries/stores. Key components:

- `ConversationList` — reads `useConversations()` (server state) + `presenceStore` (real-time overlay) to render each row with an online dot and unread badge.
- `MessageList` — reads `useMessages(conversationId)` (paginated server state, infinite-query) merged with any live messages arriving over the socket (appended into the same query cache — see §4).
- `MessageInput` — local component state for draft text; emits `typing:start`/`typing:stop` (debounced) and, on submit, calls the socket send helper with a generated `clientMessageId`.
- `TypingIndicator` — reads `typingStore` for the active conversation.
- `PresenceDot` / `LastSeenLabel` — read `presenceStore`.

## 4. State Management Approach

Three explicit categories, per ARCHITECTURE.md §3:

| Kind | Examples | Tool | Why |
|---|---|---|---|
| **Server state** | conversation list, message history pages, user profile, search results | **TanStack Query** | Handles caching, loading/error states, pagination (`useInfiniteQuery`), and — critically — refetch-on-reconnect, which directly supports the reconciliation-on-reconnect requirement in REALTIME.md. |
| **Client/UI state** | active conversation id, draft message text, modal/menu open | React local state (`useState`) or route params | Doesn't need to be global or shared; keeping it local avoids unnecessary re-renders elsewhere. |
| **Real-time state** | online user set, last-seen timestamps, typing-in-progress, live delivery/read status updates | **Zustand stores** | Updated by socket event handlers as events arrive; read by components. Kept separate from TanStack Query's server-state cache because it changes for reasons unrelated to any REST fetch — but see §5 for how a live *message* still lands in the message-history cache, not a separate store. |

**Decision: Zustand over Redux Toolkit for real-time/client state.**
**WHY:** The real-time state here is small and shape-simple (a set of online user IDs, a map of typing booleans) — Redux's action/reducer/selector ceremony adds ~zero value at this scale and reduces explainability (more boilerplate to walk an interviewer through with no corresponding benefit).
**ALTERNATIVES:** Redux Toolkit, plain React Context.
**TRADEOFF:** Zustand has less ecosystem tooling (fewer devtools, middleware options) than Redux Toolkit, and plain Context would avoid a dependency entirely but causes broad re-renders for high-frequency updates (typing events, presence) without manual memoization — Zustand's selector-based subscriptions solve exactly that problem simply.
**INTERVIEW EXPLANATION:** "I used Zustand for real-time UI state because it's small, frequently-updating state where Redux's boilerplate wouldn't pay for itself, and Context would cause unnecessary re-renders across the tree without careful memoization that Zustand gives me for free via selectors."

**Decision: TanStack Query over plain fetch+useEffect for server state.**
**WHY:** Message history and conversation lists need caching, pagination, loading/error state, and — importantly — a clean way to trigger "refetch after reconnect," all of which TanStack Query provides out of the box instead of hand-rolled `useEffect` + `useState` boilerplate repeated per screen.
**ALTERNATIVES:** plain `fetch` in `useEffect` with manual loading/error state; SWR (comparable to TanStack Query).
**TRADEOFF:** One more dependency and a caching layer whose invalidation rules need to be understood (when a socket event should update the cache vs. trigger a refetch) — worth it given how central pagination and reconnection-refetch are to this app's requirements.
**INTERVIEW EXPLANATION:** "I used TanStack Query because two of the hardest reliability requirements — paginated history and resync-on-reconnect — are exactly what it's built for, and hand-rolling that logic per-screen would be both more code and more bug-prone."

## 5. API Layer

`api/client.js`: a thin `fetch` wrapper — always `credentials: 'include'` (so httpOnly cookies are sent), always parses the JSON error envelope on non-2xx into a typed error, and implements the single-retry-after-refresh pattern:

```
call(url, opts) → 401 INVALID_TOKEN → POST /auth/refresh once → retry original call once → if still 401, force logout
```

This lives in exactly one place so no component or query hook needs to know about the refresh flow.

## 6. Authentication State

`authStore` (Zustand): `{user, status: 'idle'|'loading'|'authenticated'|'unauthenticated'}`. Populated on app load via `GET /users/me` (cookie sent automatically; if it fails, user is unauthenticated — no token ever touches JS-accessible storage, consistent with ARCHITECTURE.md's cookie decision). Login/register/logout flows call the API then update this store; the socket connection (see §9) is established/torn down reactively based on `status`.

## 7. Conversation State

Server state via `useConversations()` (`useQuery`, keyed `['conversations']`). A live `message:new` / `presence:*` event doesn't refetch the whole list — instead the socket event handler surgically updates the relevant conversation's cache entry (`lastMessageAt`, `lastMessagePreview`, `unreadCount`) via `queryClient.setQueryData`, which is far cheaper than a full refetch and keeps the list reactive to real-time events without treating sockets and REST as two disconnected sources of truth.

## 8. Message State

Server state via `useMessages(conversationId)` (`useInfiniteQuery`, keyed `['messages', conversationId]`, pages fetched with the cursor contract from BACKEND.md §12). A `message:new` socket event for the active conversation is appended into that same query's cache (front of the newest page) — not stored in a parallel "live messages" array — so the message list always renders from one source and there's no risk of a message appearing twice (once from a live-messages array, once from a subsequent refetch).

## 9. Socket Connection Management

`useSocketConnection()` hook, mounted once near the app root: connects when `authStore.status === 'authenticated'`, disconnects on logout. `socketClient.js` holds a single module-level `socket.io-client` instance (not re-created per component) configured with Socket.IO's built-in reconnection (exponential backoff, enabled by default). On every successful `connect` event (including reconnects), the client:
1. Triggers a refetch of `['conversations']` (cheap, corrects any missed presence/unread updates).
2. If a conversation is currently open, triggers a targeted "fetch messages after my last known message id" call for just that conversation (see BACKEND.md's `after` cursor param) rather than a full refetch, per REALTIME.md's reconnection/sync flow.

## 10. Optimistic UI Strategy

Sending a message is optimistic: `MessageInput` immediately renders the outgoing message (with a local `clientMessageId`, status `sending`) in the `useMessages` cache before the server ack returns. On ack success, the optimistic entry is reconciled with the server-assigned `_id`/`createdAt` (matched by `clientMessageId`). On ack failure (or a timeout with no ack), the entry's status flips to `failed` with a retry affordance — it is never silently dropped. This directly mirrors the idempotency contract in REALTIME.md: retry re-sends the *same* `clientMessageId`, so even a duplicate-looking retry can never create a duplicate persisted message.

Read receipts and presence are **not** optimistic — they reflect confirmed server/socket state only, since showing a false "read" or "online" indicator is a worse UX failure than a brief delay.

## 11. Loading States

- Initial conversation list / message history: skeleton placeholders (not a blocking full-page spinner) via TanStack Query's `isLoading`.
- Pagination ("load older messages"): an inline spinner at the top of the message list, driven by `isFetchingNextPage`.
- Login/register submit: button-level disabled+spinner state, not a page-level block.

## 12. Error States

- Query errors (`isError`) render an inline retry affordance in the relevant panel, not a global error boundary takeover (a failed conversation-list fetch shouldn't nuke the whole UI).
- A top-level React error boundary still exists as a last-resort catch for render-time exceptions.
- Failed message sends surface inline on the message bubble itself (see §10), not as a toast that can be missed.

## 13. Reconnection UI

A persistent, unobtrusive connection-status indicator (small banner or dot) reflects the socket's state machine from ARCHITECTURE.md §12: `connected` (hidden/neutral), `reconnecting` (visible, "Reconnecting…"), `disconnected`/`rejected` (visible, prompts re-login if the cause is auth failure vs. just network). Message sending is disabled with a clear reason while disconnected rather than silently queuing forever with no feedback.

## 14. Unread Messages

Per-conversation unread count badge in `ConversationList`, sourced from the conversation's cached `unreadCount` field (updated live via `message:new` for other conversations, or cleared via the `message:read` flow — see §7 — for the currently-open one). A conversation is marked read when it's the active route **and** the tab is focused/visible (using the Page Visibility API) — merely having the route open in a backgrounded tab does not mark messages read.

## 15. Presence UI

Green/gray dot on `ConversationListItem` and in the open chat's header, driven by `presenceStore`. When offline, replaced by a `LastSeenLabel` ("last seen 2 hours ago") computed from the user's `lastSeenAt`.

## 16. Typing Indicator UI

`MessageInput` emits `typing:start` on first keystroke after idle, and `typing:stop` after a debounce window (e.g. 2s of no input) or on submit/blur — never left to expire only via a server-side timeout as the sole mechanism (client-initiated stop keeps the indicator snappy; a server-side TTL is still the backstop for a client that disconnects mid-type, see REALTIME.md). The open chat's header/footer shows "X is typing…" driven by `typingStore`, scoped to the active conversation only.

## 17. Read Receipt UI

Message bubbles sent by the current user show a small status icon: single check (`sent`), double check (`delivered`), double check colored/filled (`read`) — a familiar, minimal pattern. No per-recipient breakdown needed since conversations are strictly 1-to-1 in MVP.

## 18. Responsive Design Expectations

- Two-pane layout (conversation list + active chat) on desktop/tablet widths; single-pane with back-navigation between list and chat on mobile widths (CSS breakpoint, no separate mobile app/route tree).
- Message input area and send affordance remain reachable above the on-screen keyboard on mobile (standard flex/viewport handling, verified manually during implementation).

## 19. Accessibility Expectations

- Semantic HTML (`<button>`, `<form>`, `<nav>`, `<ul>/<li>` for lists) over generic clickable `<div>`s.
- All interactive elements keyboard-reachable and focus-visible (no focus outline removal without a replacement indicator).
- Message list uses `aria-live="polite"` for incoming messages so screen readers announce new content without interrupting the user mid-action.
- Form inputs (login/register/profile) have associated `<label>`s, and validation errors are associated via `aria-describedby`.
- Color is never the sole indicator of state (e.g., online/offline pairs the dot color with a text label available to screen readers via `aria-label` or visually-hidden text; read-receipt icons likewise carry a text alternative).

## 20. Visual Design System Direction

Related concepts: [[Design Systems]]

### Design philosophy

The product should read as **designed**, not **assembled** — a small, opinionated visual language applied consistently, not a grab-bag of default component-library styles. Concretely, avoid: default shadcn/Bootstrap looks left unstyled, gratuitous gradients or glassmorphism, oversized hero-style typography in a utility chat UI, decorative empty-state illustrations that don't earn their space, and rounded-corner/shadow overuse that reads as "generic AI dashboard." Favor: restrained color, deliberate type hierarchy, generous whitespace, and motion that confirms an action rather than performs for its own sake.

### Styling technology

**DECISION:** Tailwind CSS, with a heavily customized theme (`tailwind.config` design tokens), not the framework's defaults, and no bundled component kit (no shadcn/DaisyUI/etc. installed wholesale).
**WHY:** Utility classes keep iteration fast and styles co-located with markup, which matters for a project built incrementally across many small milestones. The risk with Tailwind is the well-known "looks like every other Tailwind app" problem — mitigated by defining our own color/type/spacing tokens up front (below) rather than shipping default Tailwind grays and default `rounded-lg` everywhere, and by hand-building components instead of dropping in a prebuilt kit.
**ALTERNATIVES:** CSS Modules (more manual control, slower to iterate, no utility-class churn in JSX); styled-components (co-located, dynamic theming via props, adds a CSS-in-JS runtime cost and an extra dependency for a project with no server-side rendering to complicate).
**TRADEOFF:** Tailwind's velocity is worth the discipline required to not look generic — the mitigation (custom tokens, no default kit, restraint on utility defaults like default shadows/rounding) is a standing constraint on every component we build, not a one-time setup step.
**INTERVIEW EXPLANATION:** "I used Tailwind for velocity but explicitly did not use its defaults or a bundled component kit — I defined our own design tokens (color, type, spacing) so the utility-class approach doesn't collapse into the generic look Tailwind is often criticized for."

### Component sourcing

21st.dev MCP and React Bit MCP are unavailable in this environment (see CLAUDE.md §14a) — components are hand-authored, informed by general React/accessibility best practice and well-known chat-app interaction patterns (e.g. Telegram/Linear-style message density and status iconography as *reference points for interaction pattern only*, not visual style to copy), rather than pulled from an external catalog.

### Color

Neutral-first palette: a single near-black/near-white text-and-surface scale (not pure `#000`/`#fff` — softened for reduced eye strain) carries most of the UI. One restrained accent color is used sparingly and consistently: the user's own sent-message bubbles, primary actions (send, primary buttons), and focus/selection states — never scattered decoratively. Semantic colors (error/warning/success) are desaturated relative to a typical "alert red," matching the overall restrained tone. Both a light and a dark theme are supported from the same token set (CSS custom properties driving Tailwind's theme, so the token layer — not ad hoc `dark:` classes everywhere — is the source of truth).

### Typography

One typeface family for UI text (a well-hinted system/humanist sans, e.g. Inter or the OS system font stack — avoids a webfont-loading dependency for an interview project). A small, deliberate type scale (not Tailwind's full default scale) — distinct sizes for: page/section headers, conversation-list primary/secondary text, message text, timestamps/metadata. Message text itself stays at a comfortable reading size (not shrunk to fit more on screen); metadata (timestamps, "typing…", delivery ticks) is visually de-emphasized via size and color weight, not just smaller text.

### Spacing & rhythm

An 8px base spacing unit drives all padding/gaps/margins (a constrained Tailwind spacing scale, not arbitrary values). Consistent vertical rhythm within the message list (spacing between messages from the same sender vs. a new sender/time-gap grouping, mirroring how real chat apps group consecutive messages) rather than uniform spacing regardless of context.

### Motion

Motion is used only to confirm state changes a user should notice: a sent message's optimistic-to-confirmed transition, a new incoming message entering the list, the typing indicator's own animation, a toast/banner for connection loss and recovery. Standard durations (~150–200ms, ease-out) throughout; no motion on routine layout (list scrolling, route changes) beyond what's needed for the state changes above. Respects `prefers-reduced-motion`.
