import { z } from 'zod';

import { objectId } from './common.schema.js';

// Shared payload shape for conversation:join and conversation:leave
// (REALTIME.md §10) — deliberately the only field ever read from either
// payload, so a client-supplied userId/senderId alongside it is never
// parsed through to a handler (TESTING.md #10).
export const conversationRoomSchema = z.object({
  conversationId: objectId,
});
