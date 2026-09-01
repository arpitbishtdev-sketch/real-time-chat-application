import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

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

describe('POST /api/conversations', () => {
  it('creates a conversation between two existing users', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });

    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });

    expect(res.status).toBe(201);
    expect(res.body.conversation.otherParticipant.displayName).toBe('Bob');
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it('is idempotent — creating the same pair twice returns the same document', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);

    const first = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });
    const second = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.conversation._id).toBe(first.body.conversation._id);
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it('is idempotent regardless of which participant initiates', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);

    const first = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });
    const second = await request(app)
      .post('/api/conversations')
      .set('Cookie', [b.authCookie])
      .send({ participantId: a.user._id });

    expect(second.status).toBe(200);
    expect(second.body.conversation._id).toBe(first.body.conversation._id);
  });

  // TESTING.md #26 — concurrent creation must never surface a 500 from the
  // losing request's E11000, and both callers must resolve to one document.
  it('two concurrent creation requests for the same pair both succeed with one document (TESTING.md #26)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/conversations')
        .set('Cookie', [a.authCookie])
        .send({ participantId: b.user._id }),
      request(app)
        .post('/api/conversations')
        .set('Cookie', [b.authCookie])
        .send({ participantId: a.user._id }),
    ]);

    expect([res1.status, res2.status].sort()).toEqual([200, 201]);
    expect(res1.body.conversation._id).toBe(res2.body.conversation._id);
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it('rejects starting a conversation with yourself', async () => {
    const a = await registerUser(app);

    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: a.user._id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MESSAGE_SELF');
  });

  it('returns 404 USER_NOT_FOUND for a well-formed but nonexistent participant id', async () => {
    const a = await registerUser(app);
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: fakeId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects a malformed participant id with 400 VALIDATION_ERROR', async () => {
    const a = await registerUser(app);

    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: 'not-an-object-id' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const b = await registerUser(app);
    const res = await request(app).post('/api/conversations').send({ participantId: b.user._id });
    expect(res.status).toBe(401);
  });
});
