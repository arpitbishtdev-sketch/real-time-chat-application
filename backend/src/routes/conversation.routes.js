import { Router } from 'express';

import * as conversationController from '../controllers/conversation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadSchema,
  conversationIdParamSchema,
} from '../validation/conversation.schema.js';

export function createConversationRouter() {
  const router = Router();

  router.use(authenticate);

  router.post('/', validate(createConversationSchema), conversationController.create);
  router.get('/', validate(listConversationsQuerySchema, 'query'), conversationController.list);
  router.get(
    '/:id/messages',
    validate(conversationIdParamSchema, 'params'),
    validate(listMessagesQuerySchema, 'query'),
    conversationController.getMessages
  );
  router.post(
    '/:id/read',
    validate(conversationIdParamSchema, 'params'),
    validate(markReadSchema),
    conversationController.markRead
  );

  return router;
}
