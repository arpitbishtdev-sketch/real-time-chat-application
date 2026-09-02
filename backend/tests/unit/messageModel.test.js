import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

import { Message } from '../../src/models/Message.js';

// PROJECT_SPEC.md M10 task 3 / TESTING.md #15's second half — the Zod
// boundary (tests/unit/socketSchema.test.js, tests/integration/
// socket.messageSend.test.js) only proves the *socket-layer* gate rejects
// an oversized message. Defense in depth (BACKEND.md §14) means the
// Mongoose `maxlength: 4000` constraint on `Message.text` must independently
// reject the same input too, in case that first gate were ever bypassed —
// this exercises the model directly (validateSync, no DB round trip needed
// since Mongoose's built-in validators run without a live connection) so
// that claim is actually verified, not just asserted in prose.
describe('Message model — text maxlength defense in depth (TESTING.md #15)', () => {
  function build(text) {
    return new Message({
      conversationId: new mongoose.Types.ObjectId(),
      senderId: new mongoose.Types.ObjectId(),
      clientMessageId: randomUUID(),
      text,
    });
  }

  it('passes model-level validation at exactly 4000 characters', async () => {
    await expect(build('a'.repeat(4000)).validate()).resolves.toBeUndefined();
  });

  it('fails model-level validation at 4001 characters, independent of Zod', async () => {
    const err = await build('a'.repeat(4001))
      .validate()
      .catch((caught) => caught);
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(err.errors.text).toBeDefined();
  });
});
