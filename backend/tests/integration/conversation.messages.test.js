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

describe('GET /api/conversations/:id/messages', () => {
  it('returns an empty page for a participant (real history lands in M5/M6)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const conversation = await createConversation(app, a, b.user._id);

    const res = await request(app)
      .get(`/api/conversations/${conversation._id}/messages`)
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [], nextCursor: null });
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
