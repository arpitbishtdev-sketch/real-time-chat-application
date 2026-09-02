import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import mongoose from 'mongoose';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { sendMessage } from '../../src/services/conversation.service.js';
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

function waitForEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedMessage(conversationId, senderId, text = 'hi') {
  const { message } = await sendMessage(conversationId, senderId, {
    clientMessageId: randomUUID(),
    text,
  });
  return message;
}

describe('message:delivered', () => {
  it('marks a sent message delivered and notifies the sender via message:status', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);
    const message = await seedMessage(conversationId, a.user._id);

    const senderSocket = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderSocket),
      waitForConnectOrError(recipientSocket),
    ]);

    const statusEventPromise = waitForEvent(senderSocket, 'message:status');
    recipientSocket.emit('message:delivered', {
      conversationId,
      messageId: String(message._id),
    });

    const statusEvent = await statusEventPromise;
    expect(statusEvent).toEqual({
      conversationId,
      messageId: String(message._id),
      status: 'delivered',
    });

    const stored = await Message.findById(message._id);
    expect(stored.status).toBe('delivered');
    expect(stored.deliveredAt).toBeInstanceOf(Date);

    senderSocket.close();
    recipientSocket.close();
  });

  it("reaches every one of the sender's open tabs (message:status is user-room scoped)", async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);
    const message = await seedMessage(conversationId, a.user._id);

    const senderTab1 = connectSocket(server.url, a.authCookie);
    const senderTab2 = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderTab1),
      waitForConnectOrError(senderTab2),
      waitForConnectOrError(recipientSocket),
    ]);

    const tab1Event = waitForEvent(senderTab1, 'message:status');
    const tab2Event = waitForEvent(senderTab2, 'message:status');
    recipientSocket.emit('message:delivered', {
      conversationId,
      messageId: String(message._id),
    });

    const [e1, e2] = await Promise.all([tab1Event, tab2Event]);
    expect(e1.status).toBe('delivered');
    expect(e2.status).toBe('delivered');

    senderTab1.close();
    senderTab2.close();
    recipientSocket.close();
  });

  it('a late message:delivered arriving after the message was already read is a safe no-op, never regressing status (TESTING.md #30)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);
    const message = await seedMessage(conversationId, a.user._id);

    const senderSocket = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderSocket),
      waitForConnectOrError(recipientSocket),
    ]);

    // Fast reader: mark read before any delivered confirmation ever arrives.
    const readAck = await emitAck(recipientSocket, 'message:read', {
      conversationId,
      upToMessageId: String(message._id),
    });
    expect(readAck).toEqual({ ok: true });

    let stored = await Message.findById(message._id);
    expect(stored.status).toBe('read');

    const events = [];
    senderSocket.on('message:status', (e) => events.push(e));

    // The stale/late delivered confirmation arrives afterward.
    recipientSocket.emit('message:delivered', {
      conversationId,
      messageId: String(message._id),
    });
    await delay(150);

    stored = await Message.findById(message._id);
    expect(stored.status).toBe('read');
    // No-op: nothing changed, so no message:status broadcast for it either.
    expect(events.filter((e) => e.status === 'delivered')).toHaveLength(0);

    senderSocket.close();
    recipientSocket.close();
  });

  it('is a no-op (no broadcast) for a redundant delivered confirmation on an already-delivered message', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);
    const message = await seedMessage(conversationId, a.user._id);

    const senderSocket = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderSocket),
      waitForConnectOrError(recipientSocket),
    ]);

    const firstStatusEvent = waitForEvent(senderSocket, 'message:status');
    recipientSocket.emit('message:delivered', { conversationId, messageId: String(message._id) });
    await firstStatusEvent;

    const events = [];
    senderSocket.on('message:status', (e) => events.push(e));
    recipientSocket.emit('message:delivered', { conversationId, messageId: String(message._id) });
    await delay(150);

    expect(events).toHaveLength(0);

    senderSocket.close();
    recipientSocket.close();
  });

  it('silently ignores message:delivered from a non-participant — no status change, no broadcast', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const eve = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);
    const message = await seedMessage(conversationId, a.user._id);

    const senderSocket = connectSocket(server.url, a.authCookie);
    const eveSocket = connectSocket(server.url, eve.authCookie);
    await Promise.all([waitForConnectOrError(senderSocket), waitForConnectOrError(eveSocket)]);

    const events = [];
    senderSocket.on('message:status', (e) => events.push(e));
    const eveErrors = [];
    eveSocket.on('error', (e) => eveErrors.push(e));

    eveSocket.emit('message:delivered', { conversationId, messageId: String(message._id) });
    await delay(150);

    expect(events).toHaveLength(0);
    expect(eveErrors).toHaveLength(0);
    const stored = await Message.findById(message._id);
    expect(stored.status).toBe('sent');

    senderSocket.close();
    eveSocket.close();
  });

  it('a recipient online but never confirming delivery leaves the message at status "sent" (task 8)', async () => {
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

    const ack = await emitAck(senderSocket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'never confirmed',
    });
    expect(ack.ok).toBe(true);
    expect(ack.message.status).toBe('sent');

    await delay(100);
    const stored = await Message.findById(ack.message._id);
    expect(stored.status).toBe('sent');

    senderSocket.close();
    recipientSocket.close();
  });
});

describe('message:read', () => {
  it('marks messages read up to the watermark, acks {ok:true}, clears unreadCount, and notifies the sender', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const msg1 = await seedMessage(conversationId, a.user._id, 'one');
    await seedMessage(conversationId, a.user._id, 'two');

    const senderSocket = connectSocket(server.url, a.authCookie);
    const recipientSocket = connectSocket(server.url, b.authCookie);
    await Promise.all([
      waitForConnectOrError(senderSocket),
      waitForConnectOrError(recipientSocket),
    ]);

    const statusEventPromise = waitForEvent(senderSocket, 'message:status');
    const ack = await emitAck(recipientSocket, 'message:read', {
      conversationId,
      upToMessageId: String(msg1._id),
    });
    expect(ack).toEqual({ ok: true });

    const statusEvent = await statusEventPromise;
    expect(statusEvent).toEqual({
      conversationId,
      upToMessageId: String(msg1._id),
      status: 'read',
    });

    const stored1 = await Message.findById(msg1._id);
    expect(stored1.status).toBe('read');
    expect(stored1.readAt).toBeInstanceOf(Date);

    const conversation = await Conversation.findById(conversationId);
    // Partial read (msg2 not covered) — exactly one of the two unread
    // messages was cleared.
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);

    senderSocket.close();
    recipientSocket.close();
  });

  it('rejects an invalid upToMessageId (not in this conversation) with ack {ok:false, VALIDATION_ERROR}', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const recipientSocket = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(recipientSocket);

    const fakeMessageId = new mongoose.Types.ObjectId().toString();
    const ack = await emitAck(recipientSocket, 'message:read', {
      conversationId,
      upToMessageId: fakeMessageId,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });

    recipientSocket.close();
  });

  it('rejects a non-participant with ack {ok:false, FORBIDDEN} and leaves state untouched', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const eve = await registerUser(app, { displayName: 'Eve' });
    const conversationId = await createConversation(a, b);
    const msg1 = await seedMessage(conversationId, a.user._id);

    const eveSocket = connectSocket(server.url, eve.authCookie);
    await waitForConnectOrError(eveSocket);

    const ack = await emitAck(eveSocket, 'message:read', {
      conversationId,
      upToMessageId: String(msg1._id),
    });

    expect(ack).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });

    const stored = await Message.findById(msg1._id);
    expect(stored.status).toBe('sent');

    eveSocket.close();
  });

  it('rejects a malformed payload with ack {ok:false, VALIDATION_ERROR}', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:read', { conversationId: 'not-an-id' });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });

    socket.close();
  });

  it('two concurrent message:read calls (two tabs) with different watermarks converge to the higher one, no lost/negative unreadCount (TESTING.md #21)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const msg1 = await seedMessage(conversationId, a.user._id, 'one');
    const msg2 = await seedMessage(conversationId, a.user._id, 'two');
    await seedMessage(conversationId, a.user._id, 'three');

    const bTab1 = connectSocket(server.url, b.authCookie);
    const bTab2 = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(bTab1), waitForConnectOrError(bTab2)]);

    const [ack1, ack2] = await Promise.all([
      emitAck(bTab1, 'message:read', { conversationId, upToMessageId: String(msg1._id) }),
      emitAck(bTab2, 'message:read', { conversationId, upToMessageId: String(msg2._id) }),
    ]);
    expect(ack1).toEqual({ ok: true });
    expect(ack2).toEqual({ ok: true });

    const stored1 = await Message.findById(msg1._id);
    const stored2 = await Message.findById(msg2._id);
    expect(stored1.status).toBe('read');
    expect(stored2.status).toBe('read');

    // Higher watermark wins: exactly the two covered messages were cleared,
    // regardless of which call's DB write happened to finish first.
    const conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);

    bTab1.close();
    bTab2.close();
  });

  it('repeated/duplicate message:read calls for the same watermark are idempotent — unreadCount never drifts below the true remaining count', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const msg1 = await seedMessage(conversationId, a.user._id);
    await seedMessage(conversationId, a.user._id);

    const recipientSocket = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(recipientSocket);

    await emitAck(recipientSocket, 'message:read', {
      conversationId,
      upToMessageId: String(msg1._id),
    });
    let conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);

    // Same watermark again — msg1 no longer matches `status: {$ne:'read'}`,
    // so modifiedCount is 0 and unreadCount must not be decremented again.
    const secondAck = await emitAck(recipientSocket, 'message:read', {
      conversationId,
      upToMessageId: String(msg1._id),
    });
    expect(secondAck).toEqual({ ok: true });

    conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);

    recipientSocket.close();
  });

  it('a concurrent new message arriving during a read is never lost — unreadCount correctly ends at 1, not 0 (avoids the read clobbering the send)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const msg1 = await seedMessage(conversationId, a.user._id, 'first');
    let conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);

    const recipientSocket = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(recipientSocket);

    // Fire the read (clearing msg1) and a brand-new second message
    // (incrementing unreadCount again) concurrently — a naive `$set: 0`
    // read-clear would race with the send's atomic $inc and could wipe out
    // the legitimately-unread second message.
    await Promise.all([
      emitAck(recipientSocket, 'message:read', {
        conversationId,
        upToMessageId: String(msg1._id),
      }),
      seedMessage(conversationId, a.user._id, 'second'),
    ]);

    conversation = await Conversation.findById(conversationId);
    expect(conversation.unreadCount.get(b.user._id)).toBe(1);
    expect(await Message.countDocuments({ conversationId })).toBe(2);

    recipientSocket.close();
  });
});
