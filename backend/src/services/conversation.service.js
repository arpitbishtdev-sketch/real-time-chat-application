import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { Message } from '../models/Message.js';
import { AppError } from '../utils/AppError.js';
import { encodeCursor, decodeCursor } from '../utils/cursor.js';

const PUBLIC_USER_FIELDS = 'displayName avatarUrl statusText lastSeenAt';

// No exact truncation length is specified in BACKEND.md ("truncated text of
// last message") — 120 chars is a reasonable conversation-list preview
// length, kept local to this one call site since nothing else needs it.
const PREVIEW_MAX_LENGTH = 120;

function buildPreview(text) {
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
}

function participantsKey(idA, idB) {
  return [String(idA), String(idB)].sort().join('_');
}

function getUnreadCountFor(conversation, userId) {
  const key = String(userId);
  if (conversation.unreadCount instanceof Map) {
    return conversation.unreadCount.get(key) ?? 0;
  }
  return conversation.unreadCount?.[key] ?? 0;
}

// Shared message shape (REALTIME.md §10) — reused by both the
// `message:send`/`message:new` socket payloads (sockets/message.handlers.js)
// and this file's REST history endpoint, so the two delivery paths never
// drift into two different serializations of the same document.
export function shapeMessage(message) {
  return {
    _id: String(message._id),
    conversationId: String(message.conversationId),
    senderId: String(message.senderId),
    text: message.text,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  };
}

function shapeConversation(conversation, userId) {
  const otherParticipant = conversation.participants.find(
    (p) => String(p._id ?? p) !== String(userId)
  );

  return {
    _id: conversation._id,
    otherParticipant: otherParticipant ?? null,
    lastMessageAt: conversation.lastMessageAt ?? null,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    unreadCount: getUnreadCountFor(conversation, userId),
    createdAt: conversation.createdAt,
  };
}

// Reused by every conversation-scoped REST route and, from M4 on, every
// conversation-scoped socket handler (BACKEND.md §7) — membership is
// always re-checked fresh against the DB, never inferred from a
// client-supplied id. Distinguishes 404 (no such conversation) from 403
// (exists, caller isn't a participant) per ARCHITECTURE.md §16's
// documented existence-leak exception. Assumes `conversationId` is
// already a syntactically valid ObjectId (enforced by route-level Zod
// validation before this runs).
export async function assertParticipant(conversationId, userId) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: userId,
  });

  if (conversation) {
    return conversation;
  }

  const exists = await Conversation.exists({ _id: conversationId });
  if (!exists) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  }
  throw new AppError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
}

export async function createConversation(userId, participantId) {
  if (String(userId) === String(participantId)) {
    throw new AppError(
      400,
      'CANNOT_MESSAGE_SELF',
      'You cannot start a conversation with yourself.'
    );
  }

  const targetUser = await User.findById(participantId);
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'The requested user does not exist.');
  }

  const key = participantsKey(userId, participantId);

  let conversation;
  let created = true;
  try {
    conversation = await Conversation.create({
      participants: [userId, participantId],
      participantsKey: key,
    });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Lost the creation race to a concurrent request for the same pair —
    // re-fetch the winner's document rather than surfacing the
    // duplicate-key error as a 500 (BACKEND.md §13a).
    conversation = await Conversation.findOne({ participantsKey: key });
    created = false;
    if (!conversation) {
      // The winner's insert must have already succeeded for our insert to
      // have collided on the unique index — this branch is unreachable in
      // practice, but re-throw rather than silently fabricate a result.
      throw err;
    }
  }

  await conversation.populate('participants', PUBLIC_USER_FIELDS);
  return { conversation: shapeConversation(conversation, userId), created };
}

// Persists a message sent via the `message:send` socket event (REALTIME.md
// §11) and, only on a genuine (non-duplicate) insert, applies the two
// atomic Conversation-metadata updates from BACKEND.md §13b. Membership is
// re-checked here (never inferred from the client-supplied conversationId
// alone), matching every other conversation-scoped action. A duplicate
// `clientMessageId` retry returns the original message and does nothing
// else — no second unread increment, no re-touched preview/timestamp
// (REALTIME.md §13).
export async function sendMessage(conversationId, senderId, { clientMessageId, text }) {
  const conversation = await assertParticipant(conversationId, senderId);

  let message;
  try {
    message = await Message.create({ conversationId, senderId, clientMessageId, text });
  } catch (err) {
    if (err.code !== 11000) {
      throw new AppError(500, 'PERSIST_FAILED', 'Failed to persist message.');
    }
    // Lost the send race to a retry of the exact same logical send (or the
    // original request actually succeeded silently) — return the
    // already-persisted message rather than surfacing the duplicate-key
    // error (REALTIME.md §13).
    const existing = await Message.findOne({ conversationId, clientMessageId });
    if (!existing) {
      // The winner's insert must have already succeeded for ours to have
      // collided on the unique index — unreachable in practice.
      throw new AppError(500, 'PERSIST_FAILED', 'Failed to persist message.');
    }
    return { message: existing, created: false };
  }

  const recipientId = conversation.participants
    .map((p) => String(p))
    .find((id) => id !== String(senderId));

  // Two separate atomic single-document operations, not a combined update
  // — the unread increment must always apply per distinct message, while
  // the preview/timestamp set only applies conditionally (BACKEND.md §13b).
  await Promise.all([
    Conversation.updateOne(
      { _id: conversationId },
      { $inc: { [`unreadCount.${recipientId}`]: 1 } }
    ),
    Conversation.updateOne(
      {
        _id: conversationId,
        $or: [{ lastMessageAt: { $exists: false } }, { lastMessageAt: { $lt: message.createdAt } }],
      },
      { $set: { lastMessageAt: message.createdAt, lastMessagePreview: buildPreview(text) } }
    ),
  ]);

  return { message, created: true };
}

export async function listConversations(userId, { cursor, limit }) {
  const filter = { participants: userId };

  if (cursor) {
    let decoded;
    try {
      decoded = decodeCursor(cursor);
    } catch (err) {
      throw new AppError(400, 'VALIDATION_ERROR', err.message);
    }
    if (typeof decoded.id !== 'string' || !('lastMessageAt' in decoded)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Malformed pagination cursor.');
    }
    const cursorDate = decoded.lastMessageAt === null ? null : new Date(decoded.lastMessageAt);
    if (cursorDate !== null && Number.isNaN(cursorDate.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Malformed pagination cursor.');
    }
    filter.$or = [
      { lastMessageAt: { $lt: cursorDate } },
      { lastMessageAt: cursorDate, _id: { $lt: decoded.id } },
    ];
  }

  const docs = await Conversation.find(filter)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('participants', PUBLIC_USER_FIELDS)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  const nextCursor = hasMore
    ? encodeCursor({ lastMessageAt: last.lastMessageAt ?? null, id: String(last._id) })
    : null;

  return {
    conversations: page.map((c) => shapeConversation(c, userId)),
    nextCursor,
  };
}

// "Load older" history for a conversation (BACKEND.md §12), newest-first,
// backed by the {conversationId, createdAt, _id} compound index (§14).
// Caller (the controller) has already re-verified membership via
// assertParticipant — this only builds and runs the query. `after` (M9)
// branches to the "newer direction" missed-message sync instead — see
// getMissedMessages below; the two are mutually exclusive by the time this
// runs (enforced by the route's Zod schema).
export async function getConversationMessages(conversationId, { cursor, after, limit }) {
  if (after) {
    return getMissedMessages(conversationId, after, limit);
  }

  const filter = { conversationId };

  if (cursor) {
    let decoded;
    try {
      decoded = decodeCursor(cursor);
    } catch (err) {
      throw new AppError(400, 'VALIDATION_ERROR', err.message);
    }
    if (typeof decoded.id !== 'string' || typeof decoded.createdAt !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Malformed pagination cursor.');
    }
    const cursorDate = new Date(decoded.createdAt);
    if (Number.isNaN(cursorDate.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Malformed pagination cursor.');
    }
    // Tuple comparison, never a naive `createdAt`-only filter — two
    // messages can legitimately share the same millisecond `createdAt`
    // under concurrent sends, and a single-field comparator would either
    // skip or duplicate the boundary message (BACKEND.md §12, TESTING.md #32).
    filter.$or = [
      { createdAt: { $lt: cursorDate } },
      { createdAt: cursorDate, _id: { $lt: decoded.id } },
    ];
  }

  const docs = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  const nextCursor = hasMore
    ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: String(last._id) })
    : null;

  return { messages: page.map(shapeMessage), nextCursor, nextAfter: null };
}

// Reconnection / missed-message sync (REALTIME.md §19, PROJECT_SPEC.md M9):
// "everything strictly newer than the last message the client already has,"
// oldest-of-the-missed-batch first, so the client can append the page
// directly onto the end of its existing history in order. `after` is a raw
// message id, not an opaque cursor blob — the client already knows the id
// of its own last message, so making it construct an encoded cursor just to
// ask "what's after this" would be pure friction. The anchor message's
// `createdAt` is resolved server-side from that id, exactly like
// markConversationRead resolves `upToMessageId` above, and a well-formed but
// nonexistent/foreign id is rejected the same way (400, not a silently
// empty result) since a bogus anchor can never legitimately be "caught up."
// Same tuple-comparison discipline as the older-direction query (BACKEND.md
// §12's "newer direction" shape) — required, not optional, since two
// messages can share the same millisecond `createdAt` here exactly as they
// can in the older direction (TESTING.md #32).
async function getMissedMessages(conversationId, after, limit) {
  const anchor = await Message.findOne({ _id: after, conversationId }).lean();
  if (!anchor) {
    throw new AppError(400, 'VALIDATION_ERROR', 'after is not a message in this conversation.');
  }

  const docs = await Message.find({
    conversationId,
    $or: [
      { createdAt: { $gt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $gt: anchor._id } },
    ],
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  return {
    messages: page.map(shapeMessage),
    nextCursor: null,
    nextAfter: hasMore ? String(last._id) : null,
  };
}

// `message:delivered` (REALTIME.md §11) — recipient confirms receipt of one
// specific message. Membership is re-checked here (no REST equivalent
// calls this, unlike markConversationRead below). Returns null for every
// no-op case (message not in this conversation, or already at `delivered`
// or `read`) so the caller knows not to broadcast — matching the event
// table's "silently ignored" framing for both the authz and the
// already-read cases (BACKEND.md §14, TESTING.md #30).
export async function markMessageDelivered(conversationId, messageId, userId) {
  await assertParticipant(conversationId, userId);

  const message = await Message.findOne({ _id: messageId, conversationId });
  if (!message) {
    return null;
  }

  const deliveredAt = new Date();
  // Conditional atomic update — only advances a message still at `sent`,
  // so a delivered event arriving after the message was already read (or
  // already delivered, e.g. a duplicate confirmation from a second tab)
  // matches zero documents and is a safe no-op, never a regression.
  const result = await Message.updateOne(
    { _id: messageId, status: 'sent' },
    { $set: { status: 'delivered', deliveredAt } }
  );

  if (result.modifiedCount === 0) {
    return null;
  }

  return { messageId: String(message._id), senderId: String(message.senderId), deliveredAt };
}

// `message:read` / `POST /conversations/:id/read` (REALTIME.md §11/§17,
// BACKEND.md §15) — bulk "read up to X" watermark, naturally idempotent
// and commutative regardless of call order or overlapping ranges (TESTING.md
// #21). Caller has already re-verified membership (mirrors
// getConversationMessages's contract above) — this only mutates state.
//
// Unread-count clearing is a **delta decrement by exactly the number of
// messages this call actually flipped to `read`**, never an absolute
// `$set` to 0: an unconditional 0 would (a) race with M5's concurrent
// atomic `$inc` for a brand-new message arriving mid-read, clobbering a
// legitimately-unread message back to "read", and (b) be wrong outright
// for a *partial* read (an `upToMessageId` that isn't the newest message
// leaves newer messages still unread) — see BACKEND.md §13b/§14.
export async function markConversationRead(conversationId, userId, upToMessageId) {
  const cursorMessage = await Message.findOne({ _id: upToMessageId, conversationId });
  if (!cursorMessage) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'upToMessageId is not a message in this conversation.'
    );
  }

  const readAt = new Date();
  const result = await Message.updateMany(
    {
      conversationId,
      senderId: { $ne: userId },
      createdAt: { $lte: cursorMessage.createdAt },
      status: { $ne: 'read' },
    },
    { $set: { status: 'read', readAt } }
  );

  const conversation =
    result.modifiedCount > 0
      ? await Conversation.findOneAndUpdate(
          { _id: conversationId },
          { $inc: { [`unreadCount.${userId}`]: -result.modifiedCount } },
          { returnDocument: 'after' }
        )
      : await Conversation.findById(conversationId);

  const otherParticipantId = conversation.participants
    .map((p) => String(p))
    .find((id) => id !== String(userId));

  return {
    unreadCount: getUnreadCountFor(conversation, userId),
    modifiedCount: result.modifiedCount,
    otherParticipantId,
  };
}
