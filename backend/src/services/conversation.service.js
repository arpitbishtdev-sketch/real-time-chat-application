import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { encodeCursor, decodeCursor } from '../utils/cursor.js';

const PUBLIC_USER_FIELDS = 'displayName avatarUrl statusText lastSeenAt';

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

// Route/authz/shape wired now; the real query against persisted messages
// is implemented in M5/M6 once the Message model exists — this
// deliberately returns an empty page until then (PROJECT_SPEC.md M3 task 7).
export async function getConversationMessages(conversationId, { cursor }) {
  if (cursor) {
    try {
      const decoded = decodeCursor(cursor);
      if (typeof decoded.id !== 'string' || typeof decoded.createdAt !== 'string') {
        throw new Error('Malformed pagination cursor.');
      }
    } catch (err) {
      throw new AppError(400, 'VALIDATION_ERROR', err.message);
    }
  }

  return { messages: [], nextCursor: null };
}

// Route/authz/shape wired now; real read-state mutation lands in M8 once
// Message.status exists (PROJECT_SPEC.md M3 task 8).
export async function markConversationRead() {
  return { unreadCount: 0 };
}
