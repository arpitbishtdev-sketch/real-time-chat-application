import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import mongoose from 'mongoose';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { Message } from '../../src/models/Message.js';
import { Conversation } from '../../src/models/Conversation.js';

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

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('message:send', () => {
  it('persists a valid message and acks {ok:true, message}', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const clientMessageId = randomUUID();
    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'hello there',
    });

    expect(ack.ok).toBe(true);
    expect(ack.message).toMatchObject({
      conversationId,
      senderId: a.user._id,
      text: 'hello there',
      status: 'sent',
    });

    const stored = await Message.findOne({ conversationId, clientMessageId });
    expect(stored).not.toBeNull();
    expect(stored.text).toBe('hello there');
    expect(stored.senderId.toString()).toBe(a.user._id);

    socket.close();
  });

  it('delivers message:new to a joined recipient in the conversation room', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const senderSocket = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderSocket),
      waitForConnectOrError(recipientSocket),
    ]);
    await emitAck(recipientSocket, 'conversation:join', { conversationId });

    const received = new Promise((resolve) => recipientSocket.once('message:new', resolve));

    const ack = await emitAck(senderSocket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'hi Bob',
    });
    expect(ack.ok).toBe(true);

    const event = await received;
    expect(event.message.text).toBe('hi Bob');
    expect(event.message._id).toBe(ack.message._id);

    senderSocket.close();
    recipientSocket.close();
  });

  it('rejects an empty/whitespace-only message with VALIDATION_ERROR, never reaching persistence', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: '     ',
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(await Message.countDocuments({ conversationId })).toBe(0);

    socket.close();
  });

  it('rejects an oversized message (>4000 chars) with VALIDATION_ERROR', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'a'.repeat(4001),
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(await Message.countDocuments({ conversationId })).toBe(0);

    socket.close();
  });

  it('rejects a malformed payload (non-string text) with VALIDATION_ERROR, never reaching persistence', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 12345,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(await Message.countDocuments({ conversationId })).toBe(0);

    socket.close();
  });

  it('rejects a non-participant sender with FORBIDDEN and persists nothing', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const eve = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, eve.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'I should not be able to send this',
    });

    expect(ack).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
    expect(await Message.countDocuments({ conversationId })).toBe(0);

    socket.close();
  });

  it('a duplicate clientMessageId retry acks the original message and does not double-increment unreadCount or re-touch lastMessageAt/lastMessagePreview (TESTING.md #8)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const clientMessageId = randomUUID();
    const firstAck = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'original send',
    });
    expect(firstAck.ok).toBe(true);

    const afterFirst = await Conversation.findById(conversationId);
    expect(afterFirst.unreadCount.get(b.user._id)).toBe(1);
    const lastMessageAtAfterFirst = afterFirst.lastMessageAt.getTime();

    const retryAck = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'original send',
    });

    expect(retryAck.ok).toBe(true);
    expect(retryAck.message._id).toBe(firstAck.message._id);
    expect(await Message.countDocuments({ conversationId })).toBe(1);

    const afterRetry = await Conversation.findById(conversationId);
    expect(afterRetry.unreadCount.get(b.user._id)).toBe(1);
    expect(afterRetry.lastMessageAt.getTime()).toBe(lastMessageAtAfterFirst);

    socket.close();
  });

  it('two concurrent, distinct messages both correctly increment unreadCount with no lost update (TESTING.md #19)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const [ack1, ack2] = await Promise.all([
      emitAck(socket, 'message:send', {
        conversationId,
        clientMessageId: randomUUID(),
        text: 'first',
      }),
      emitAck(socket, 'message:send', {
        conversationId,
        clientMessageId: randomUUID(),
        text: 'second',
      }),
    ]);

    expect(ack1.ok).toBe(true);
    expect(ack2.ok).toBe(true);
    expect(await Message.countDocuments({ conversationId })).toBe(2);

    const conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(2);

    socket.close();
  });

  it('two rapid same-sender sends persist with createdAt in actual send order, even when the first send is artificially delayed past the second (TESTING.md #28)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const originalCreate = Message.create.bind(Message);
    vi.spyOn(Message, 'create').mockImplementation(async (doc) => {
      if (doc.text === 'first') {
        await delay(75);
      }
      return originalCreate(doc);
    });

    const firstAckPromise = emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'first',
    });
    // Give the first send's handler a tick to start (and hit the delay)
    // before firing the second, so the second's write would genuinely race
    // ahead of the first without the per-conversation ordering chain.
    await delay(5);
    const secondAckPromise = emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'second',
    });

    const [firstAck, secondAck] = await Promise.all([firstAckPromise, secondAckPromise]);
    expect(firstAck.ok).toBe(true);
    expect(secondAck.ok).toBe(true);

    const ordered = await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 });
    expect(ordered.map((m) => m.text)).toEqual(['first', 'second']);

    socket.close();
  });

  it('a broadcast failure after successful persistence still yields ack {ok:true, message} (TESTING.md #29)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    vi.spyOn(server.io, 'to').mockImplementation(() => {
      throw new Error('broadcast boom');
    });

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'still safe',
    });

    expect(ack.ok).toBe(true);
    expect(ack.message.text).toBe('still safe');
    expect(await Message.countDocuments({ conversationId })).toBe(1);

    socket.close();
  });

  it('ignores a client-supplied senderId — the persisted sender is always the authenticated socket.userId', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const eve = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'spoof attempt',
      senderId: eve.user._id,
    });

    expect(ack.ok).toBe(true);
    expect(ack.message.senderId).toBe(a.user._id);

    socket.close();
  });

  it('returns CONVERSATION_NOT_FOUND for a well-formed but nonexistent conversation id', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const fakeId = new mongoose.Types.ObjectId().toString();
    const ack = await emitAck(socket, 'message:send', {
      conversationId: fakeId,
      clientMessageId: randomUUID(),
      text: 'hello',
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'CONVERSATION_NOT_FOUND', message: expect.any(String) },
    });

    socket.close();
  });
});
