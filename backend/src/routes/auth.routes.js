import { Router } from 'express';

import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { registerSchema, loginSchema } from '../validation/auth.schema.js';
import { createAuthRateLimiters } from '../middleware/rateLimit.js';

// A factory rather than a module-level router: createApp() calls this
// fresh each time so the rate limiters it wires in are fresh too (see
// rateLimit.js for why that matters).
export function createAuthRouter() {
  const router = Router();
  const { registerRateLimiter, loginRateLimiter, refreshRateLimiter } = createAuthRateLimiters();

  router.post(
    '/register',
    registerRateLimiter,
    validate(registerSchema),
    authController.register
  );
  router.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
  router.post('/refresh', refreshRateLimiter, authController.refresh);
  router.post('/logout', authenticate, authController.logout);
  router.post('/logout-all', authenticate, authController.logoutAll);

  return router;
}
