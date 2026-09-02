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
// assertParticipant — this only builds and runs the query.
export async function getConversationMessages(conversationId, { cursor, limit }) {
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

  return { messages: page.map(shapeMessage), nextCursor };
}

// Route/authz/shape wired now; real read-state mutation lands in M8 once
// Message.status exists (PROJECT_SPEC.md M3 task 8).
export async function markConversationRead() {
  return { unreadCount: 0 };
}
