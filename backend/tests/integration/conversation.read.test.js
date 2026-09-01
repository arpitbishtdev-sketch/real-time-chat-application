import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../../src/app.js';
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

describe('POST /api/conversations/:id/read', () => {
  it('is wired for a participant and returns the documented shape (real logic lands in M8)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);
    const fakeMessageId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/read`)
      .set('Cookie', [a.authCookie])
      .send({ upToMessageId: fakeMessageId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 0 });
  });

  it('rejects a non-participant with 403 FORBIDDEN', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/read`)
      .set('Cookie', [c.authCookie])
      .send({ upToMessageId: new mongoose.Types.ObjectId().toString() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a well-formed but nonexistent conversation id', async () => {
    const a = await registerUser(app);
    const fakeConversationId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/conversations/${fakeConversationId}/read`)
      .set('Cookie', [a.authCookie])
      .send({ upToMessageId: new mongoose.Types.ObjectId().toString() });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('rejects a missing/malformed upToMessageId with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/read`)
      .set('Cookie', [a.authCookie])
      .send({ upToMessageId: 'not-an-object-id' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .post(`/api/conversations/${conversation._id}/read`)
      .send({ upToMessageId: new mongoose.Types.ObjectId().toString() });

    expect(res.status).toBe(401);
  });
});
