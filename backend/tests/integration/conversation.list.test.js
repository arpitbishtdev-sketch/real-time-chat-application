import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { Conversation } from '../../src/models/Conversation.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';

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

describe('GET /api/conversations', () => {
  it('lists only conversations the requester participates in', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);

    await createConversation(app, a, b.user._id);
    await createConversation(app, b, c.user._id); // does not involve `a`

    const res = await request(app).get('/api/conversations').set('Cookie', [a.authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
  });

  it('paginates without duplicates or gaps across pages', async () => {
    const a = await registerUser(app);
    const others = await Promise.all([registerUser(app), registerUser(app), registerUser(app)]);
    const created = [];
    for (const other of others) {
      created.push(await createConversation(app, a, other.user._id));
    }

    const page1 = await request(app)
      .get('/api/conversations')
      .query({ limit: 2 })
      .set('Cookie', [a.authCookie]);
    expect(page1.status).toBe(200);
    expect(page1.body.conversations).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get('/api/conversations')
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Cookie', [a.authCookie]);
    expect(page2.status).toBe(200);
    expect(page2.body.conversations).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const seenIds = [...page1.body.conversations, ...page2.body.conversations].map((c) => c._id);
    expect(new Set(seenIds).size).toBe(3);
    expect(seenIds.sort()).toEqual(created.map((c) => c._id).sort());
  });

  it("reports only the requester's own unread count, never the other participant's", async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`unreadCount.${a.user._id}`]: 3, [`unreadCount.${b.user._id}`]: 7 } }
    );

    const resA = await request(app).get('/api/conversations').set('Cookie', [a.authCookie]);
    const resB = await request(app).get('/api/conversations').set('Cookie', [b.authCookie]);

    expect(resA.body.conversations[0].unreadCount).toBe(3);
    expect(resB.body.conversations[0].unreadCount).toBe(7);
    expect(JSON.stringify(resA.body)).not.toContain('"7"');
  });

  it('rejects a malformed cursor with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);

    const res = await request(app)
      .get('/api/conversations')
      .query({ cursor: 'not-valid-base64-json' })
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });
});
