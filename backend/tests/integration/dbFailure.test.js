import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';

// PROJECT_SPEC.md M10 tasks 6/9, TESTING.md #24 — a single mocked write/read
// failure must produce a clean, documented failure shape (never a hang or
// crash), on both the REST and socket paths. Distinct from TESTING.md #31
// (db.sustainedOutage.test.js), which covers a *prolonged* real outage and
// recovery rather than one mocked call throwing.

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe('Database failure — REST (TESTING.md #24)', () => {
  let app;

  beforeAll(connect);
  afterAll(disconnect);
  afterEach(clearDatabase);
  beforeEach(() => {
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a read failure during GET /conversations returns a clean 500, not a hang or crash', async () => {
    const a = await registerUser(app);

    vi.spyOn(Conversation, 'find').mockImplementationOnce(() => {
      throw new Error('simulated read failure');
    });

    const res = await request(app).get('/api/conversations').set('Cookie', [a.authCookie]);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('a write failure during POST /conversations returns a clean 500, not a hang or crash', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);

    vi.spyOn(Conversation, 'create').mockImplementationOnce(async () => {
      throw new Error('simulated write failure');
    });

    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('a read failure during GET /conversations/:id/messages returns a clean 500, not a hang or crash', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const createRes = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });
    const conversationId = createRes.body.conversation._id;

    vi.spyOn(Message, 'find').mockImplementationOnce(() => {
      throw new Error('simulated read failure');
    });

    const res = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Cookie', [a.authCookie]);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('Database failure — sockets (TESTING.md #24)', () => {
  let app;
  let server;

  beforeAll(connect);
  afterAll(disconnect);
  afterEach(clearDatabase);

  beforeEach(async () => {
    server = await startTestServer();
    app = server.app;
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  async function createConversation(a, b) {
    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', [a.authCookie])
      .send({ participantId: b.user._id });
    return res.body.conversation._id;
  }

  it('a persistence failure during message:send acks {ok:false, PERSIST_FAILED}, not a hang, and leaves the socket connected', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    vi.spyOn(Message, 'create').mockImplementationOnce(async () => {
      throw new Error('simulated write failure');
    });

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'this should fail cleanly',
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'PERSIST_FAILED', message: expect.any(String) },
    });
    expect(await Message.countDocuments({ conversationId })).toBe(0);
    expect(socket.connected).toBe(true);

    socket.close();
  });

  it('a write failure during message:read acks {ok:false}, not a hang, and leaves the socket connected', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const sendAck = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'seed message',
    });
    expect(sendAck.ok).toBe(true);

    vi.spyOn(Message, 'updateMany').mockImplementationOnce(async () => {
      throw new Error('simulated write failure');
    });

    const readAck = await emitAck(socket, 'message:read', {
      conversationId,
      upToMessageId: sendAck.message._id,
    });

    expect(readAck.ok).toBe(false);
    expect(readAck.error.code).toBeTruthy();
    expect(socket.connected).toBe(true);

    socket.close();
  });
});
