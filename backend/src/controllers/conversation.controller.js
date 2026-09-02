import {
  assertParticipant,
  createConversation,
  listConversations,
  getConversationMessages,
  markConversationRead,
} from '../services/conversation.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const create = asyncHandler(async (req, res) => {
  const { conversation, created } = await createConversation(req.userId, req.body.participantId);
  res.status(created ? 201 : 200).json({ conversation });
});

export const list = asyncHandler(async (req, res) => {
  const result = await listConversations(req.userId, req.validatedQuery);
  res.status(200).json(result);
});

export const getMessages = asyncHandler(async (req, res) => {
  await assertParticipant(req.params.id, req.userId);
  const result = await getConversationMessages(req.params.id, req.validatedQuery);
  res.status(200).json(result);
});

export const markRead = asyncHandler(async (req, res) => {
  await assertParticipant(req.params.id, req.userId);
  const result = await markConversationRead(req.params.id, req.userId, req.body.upToMessageId);
  res.status(200).json({ unreadCount: result.unreadCount });

  // Same real-time notification the socket `message:read` path fires
  // (REALTIME.md §11) — this REST fallback exists specifically for the
  // pre-socket-connect page-load case, so the sender's UI must not go
  // stale just because the reader used it instead of the socket event.
  // Isolated from the response above exactly like message:send's
  // ack/broadcast split (BACKEND.md §13d) — a failed broadcast here can
  // never turn an already-sent 200 into an error.
  if (result.modifiedCount > 0) {
    try {
      req.app.get('io').to(`user:${result.otherParticipantId}`).emit('message:status', {
        conversationId: req.params.id,
        upToMessageId: req.body.upToMessageId,
        status: 'read',
      });
    } catch (err) {
      console.error(err);
    }
  }
});
