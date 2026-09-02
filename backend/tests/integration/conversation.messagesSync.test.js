import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../../src/app.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { sendMessage } from '../../src/services/conversation.service.js';
import { Message } from '../../src/models/Message.js';

let app;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDatabase);
beforeEach(() => {
  app = createApp();
});

async function createConversation(initiator, participantId) {
  const res = await request(app)
    .post('/api/conversations')
    .set('Cookie', [initiator.authCookie])
    .send({ participantId });
  return res.body.conversation;
}

function getSync(cookie, conversationId, query = {}) {
  return request(app)
    .get(`/api/conversations/${conversationId}/messages`)
    .query(query)
    .set('Cookie', [cookie]);
}

// PROJECT_SPEC.md M9 tasks 2/3, REALTIME.md §19, BACKEND.md §12's "newer
// direction" — the missed-message sync a reconnecting client runs against
// `?after=<lastKnownMessageId>` to recover anything sent while it was
// disconnected, reusing the exact same tuple-cursor discipline M6 already
// established for the "load older" direction.
describe('GET /api/conversations/:id/messages?after= — missed-message sync (M9)', () => {
  it('returns only messages strictly newer than the anchor, oldest-first', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const seeded = [];
    for (let i = 0; i < 4; i += 1) {
      const { message } = await sendMessage(conversation._id, a.user._id, {
        clientMessageId: randomUUID(),
        text: `seed-${i}`,
      });
      seeded.push(message);
    }

    // Client's last known message is seed-1 — it missed seed-2 and seed-3.
    const res = await getSync(a.authCookie, conversation._id, { after: String(seeded[1]._id) });

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.text)).toEqual(['seed-2', 'seed-3']);
    expect(res.body.nextAfter).toBeNull();
    expect(res.body.nextCursor).toBeNull();
  });

  it('returns an empty page with nextAfter null when the client is already fully caught up', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const { message } = await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'only message',
    });

    const res = await getSync(a.authCookie, conversation._id, { after: String(message._id) });
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.nextAfter).toBeNull();
  });

  it('paginates a large missed-message backlog via nextAfter with no skip/duplicate across the boundary', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const { message: anchor } = await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'anchor',
    });

    const seeded = [];
    for (let i = 0; i < 5; i += 1) {
      const { message } = await sendMessage(conversation._id, b.user._id, {
        clientMessageId: randomUUID(),
        text: `missed-${i}`,
      });
      seeded.push(message);
    }

    const page1 = await getSync(a.authCookie, conversation._id, {
      after: String(anchor._id),
      limit: 3,
    });
    expect(page1.body.messages.map((m) => m.text)).toEqual(['missed-0', 'missed-1', 'missed-2']);
    expect(page1.body.nextAfter).not.toBeNull();

    const page2 = await getSync(a.authCookie, conversation._id, {
      after: page1.body.nextAfter,
      limit: 3,
    });
    expect(page2.body.messages.map((m) => m.text)).toEqual(['missed-3', 'missed-4']);
    expect(page2.body.nextAfter).toBeNull();

    const allTexts = [...page1.body.messages, ...page2.body.messages].map((m) => m.text);
    expect(new Set(allTexts).size).toBe(allTexts.length);
  });

  // TESTING.md #32's boundary case, exercised in the newer direction this
  // time — two messages sharing the exact same millisecond `createdAt` must
  // never be skipped or duplicated by the `$gt`-tuple comparison either.
  it('never skips or duplicates a message sharing the exact same createdAt millisecond as the anchor', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const sameInstant = new Date('2026-01-01T00:00:00.000Z');
    const tied1 = await Message.create({
      conversationId: conversation._id,
      senderId: a.user._id,
      clientMessageId: randomUUID(),
      text: 'tied-1',
      createdAt: sameInstant,
    });
    const tied2 = await Message.create({
      conversationId: conversation._id,
      senderId: b.user._id,
      clientMessageId: randomUUID(),
      text: 'tied-2',
      createdAt: sameInstant,
    });

    const [anchor, other] = [tied1, tied2].sort((x, y) => (x._id < y._id ? -1 : 1));

    const res = await getSync(a.authCookie, conversation._id, { after: String(anchor._id) });
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]._id).toBe(String(other._id));
  });

  it('rejects a well-formed but nonexistent after id with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await getSync(a.authCookie, conversation._id, { after: fakeId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed (non-ObjectId) after value with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const res = await getSync(a.authCookie, conversation._id, { after: 'not-an-id' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects cursor and after supplied together with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const { message } = await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'x',
    });

    const res = await getSync(a.authCookie, conversation._id, {
      after: String(message._id),
      cursor: 'anything',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-participant with 403 FORBIDDEN', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const eve = await registerUser(app);
    const conversation = await createConversation(a, b.user._id);

    const { message } = await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'x',
    });

    const res = await getSync(eve.authCookie, conversation._id, { after: String(message._id) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
