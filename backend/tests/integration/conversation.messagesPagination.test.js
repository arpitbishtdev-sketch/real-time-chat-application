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

async function createConversation(app, initiator, participantId) {
  const res = await request(app)
    .post('/api/conversations')
    .set('Cookie', [initiator.authCookie])
    .send({ participantId });
  return res.body.conversation;
}

function getPage(app, cookie, conversationId, query = {}) {
  return request(app)
    .get(`/api/conversations/${conversationId}/messages`)
    .query(query)
    .set('Cookie', [cookie]);
}

describe('GET /api/conversations/:id/messages — pagination correctness (M6)', () => {
  // PROJECT_SPEC.md M6 task 4 / TESTING.md #19 (read-side): two participants
  // sending near-simultaneously must both persist, with no lost write, and
  // both must show up correctly ordered through the history endpoint.
  it('two near-simultaneous sends from different participants both persist and both appear in history, in a well-defined order', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const [resultA, resultB] = await Promise.all([
      sendMessage(conversation._id, a.user._id, {
        clientMessageId: randomUUID(),
        text: 'from A',
      }),
      sendMessage(conversation._id, b.user._id, {
        clientMessageId: randomUUID(),
        text: 'from B',
      }),
    ]);

    expect(await Message.countDocuments({ conversationId: conversation._id })).toBe(2);

    const res = await getPage(app, a.authCookie, conversation._id);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);

    // No lost write: both persisted messages are present exactly once.
    const returnedIds = res.body.messages.map((m) => m._id).sort();
    const expectedIds = [String(resultA.message._id), String(resultB.message._id)].sort();
    expect(returnedIds).toEqual(expectedIds);

    // Well-defined order: matches a direct DB sort by (createdAt desc, _id desc).
    const direct = await Message.find({ conversationId: conversation._id }).sort({
      createdAt: -1,
      _id: -1,
    });
    expect(res.body.messages.map((m) => m._id)).toEqual(direct.map((m) => String(m._id)));
  });

  // PROJECT_SPEC.md M6 task 5: a message inserted *between* two page fetches
  // must never appear mid-page and must never cause an older page to skip or
  // duplicate a message — the exact failure mode offset pagination has and
  // cursor pagination (BACKEND.md §12) is chosen to avoid.
  it('never skips or duplicates messages across a page boundary when a new message is inserted between page fetches', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const seeded = [];
    for (let i = 0; i < 5; i += 1) {
      const { message } = await sendMessage(conversation._id, a.user._id, {
        clientMessageId: randomUUID(),
        text: `seed-${i}`,
      });
      seeded.push(message);
    }

    const page1 = await getPage(app, a.authCookie, conversation._id, { limit: 3 });
    expect(page1.body.messages.map((m) => m.text)).toEqual(['seed-4', 'seed-3', 'seed-2']);
    expect(page1.body.nextCursor).not.toBeNull();

    // A new message arrives after page 1 was fetched but before page 2 is —
    // it must not leak into page 2, and page 2 must still contain exactly
    // the two oldest seeded messages, once each.
    await sendMessage(conversation._id, b.user._id, {
      clientMessageId: randomUUID(),
      text: 'inserted-during-pagination',
    });

    const page2 = await getPage(app, a.authCookie, conversation._id, {
      limit: 3,
      cursor: page1.body.nextCursor,
    });
    expect(page2.body.messages.map((m) => m.text)).toEqual(['seed-1', 'seed-0']);
    expect(page2.body.nextCursor).toBeNull();

    const allTexts = [...page1.body.messages, ...page2.body.messages].map((m) => m.text);
    expect(new Set(allTexts).size).toBe(allTexts.length);
    expect(allTexts).not.toContain('inserted-during-pagination');
  });

  // TESTING.md #32: two messages sharing the exact same millisecond
  // `createdAt` must never be skipped or duplicated across the cursor
  // boundary — this is the case a naive single-field `createdAt` comparator
  // silently breaks on (BACKEND.md §12).
  it('never skips or duplicates a message sharing the exact same createdAt millisecond as the cursor (TESTING.md #32)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const sameInstant = new Date('2026-01-01T00:00:00.000Z');

    // Bypass the normal send path to force an exact createdAt collision —
    // Mongoose's timestamps plugin only auto-populates createdAt when it
    // isn't already set, so an explicit value here is preserved as-is.
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

    expect(tied1.createdAt.getTime()).toBe(sameInstant.getTime());
    expect(tied2.createdAt.getTime()).toBe(sameInstant.getTime());

    // Sort tiebreak is _id descending, so whichever _id is larger comes
    // first on page 1.
    const [first, second] = [tied1, tied2].sort((x, y) => (x._id > y._id ? -1 : 1));

    const page1 = await getPage(app, a.authCookie, conversation._id, { limit: 1 });
    expect(page1.body.messages).toHaveLength(1);
    expect(page1.body.messages[0]._id).toBe(String(first._id));
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await getPage(app, a.authCookie, conversation._id, {
      limit: 1,
      cursor: page1.body.nextCursor,
    });
    expect(page2.body.messages).toHaveLength(1);
    expect(page2.body.messages[0]._id).toBe(String(second._id));

    // Exactly once total across both pages — never skipped, never duplicated.
    expect(await Message.countDocuments({ conversationId: conversation._id })).toBe(2);
  });

  // PROJECT_SPEC.md M6 task 7: the endpoint must stay paginated (never an
  // unbounded scan) and its query must actually use the compound index —
  // verified via an explain plan, not assumed.
  it('stays paginated and uses the {conversationId, createdAt, _id} compound index at scale', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const TOTAL = 3000;
    const base = Date.now();
    const docs = Array.from({ length: TOTAL }, (_, i) => ({
      conversationId: conversation._id,
      senderId: i % 2 === 0 ? a.user._id : b.user._id,
      clientMessageId: randomUUID(),
      text: `message-${i}`,
      createdAt: new Date(base + i),
    }));
    await Message.insertMany(docs);

    const res = await getPage(app, a.authCookie, conversation._id, { limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(50);
    expect(res.body.nextCursor).not.toBeNull();
    // Newest-first: the last inserted message (`message-2999`) leads.
    expect(res.body.messages[0].text).toBe(`message-${TOTAL - 1}`);

    const explainResult = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(51)
      .explain('executionStats');

    const planJson = JSON.stringify(explainResult);
    expect(planJson).toContain('IXSCAN');
    expect(planJson).not.toContain('COLLSCAN');
    // A bounded index scan should examine roughly the page size, not the
    // full multi-thousand-document collection.
    expect(explainResult.executionStats.totalDocsExamined).toBeLessThan(TOTAL / 10);
  });

  it('rejects a well-formed but semantically invalid cursor (unparsable createdAt) with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const badCursor = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', id: new mongoose.Types.ObjectId().toString() }),
      'utf8'
    ).toString('base64url');

    const res = await getPage(app, a.authCookie, conversation._id, { cursor: badCursor });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
