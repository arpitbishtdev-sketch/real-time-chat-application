import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../../src/app.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { sendMessage } from '../../src/services/conversation.service.js';

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

describe('GET /api/conversations/:id/messages', () => {
  it('returns an empty page for a conversation with no messages yet', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [], nextCursor: null });
  });

  it('returns persisted messages newest-first and paginates across pages with a stable cursor', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    // Sent oldest to newest; each direct sendMessage() call gets its own
    // createdAt, so `first` < `second` < `third`.
    await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'first',
    });
    await sendMessage(conversation._id, b.user._id, {
      clientMessageId: randomUUID(),
      text: 'second',
    });
    await sendMessage(conversation._id, a.user._id, {
      clientMessageId: randomUUID(),
      text: 'third',
    });

    const page1 = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .query({ limit: 2 })
      .set('Cookie', [a.authCookie]);

    expect(page1.status).toBe(200);
    expect(page1.body.messages.map((m) => m.text)).toEqual(['third', 'second']);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Cookie', [a.authCookie]);

    expect(page2.status).toBe(200);
    expect(page2.body.messages.map((m) => m.text)).toEqual(['first']);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('rejects a non-participant with 403 FORBIDDEN, not a data leak', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .set('Cookie', [c.authCookie]);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a well-formed but nonexistent conversation id', async () => {
    const a = await registerUser(app);
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/conversations/${fakeId}/messages`)
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns 400 for a malformed (non-ObjectId) conversation id', async () => {
    const a = await registerUser(app);

    const res = await request(app)
      .get('/api/conversations/not-an-object-id/messages')
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed cursor with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .query({ cursor: 'garbage' })
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app).get(`/api/conversations/${conversation._id}/messages`);
    expect(res.status).toBe(401);
  });
});
