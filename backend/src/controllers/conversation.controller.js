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
  res.status(200).json(result);
});
