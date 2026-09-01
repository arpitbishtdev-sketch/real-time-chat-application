import { Router } from 'express';

import * as userController from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema, searchUsersQuerySchema } from '../validation/user.schema.js';

export function createUserRouter() {
  const router = Router();

  router.use(authenticate);

  router.get('/me', userController.getMe);
  router.patch('/me', validate(updateProfileSchema), userController.updateMe);
  router.get('/search', validate(searchUsersQuerySchema, 'query'), userController.search);

  return router;
}
