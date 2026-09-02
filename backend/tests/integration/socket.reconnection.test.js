import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { Message } from '../../src/models/Message.js';

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

// Polls rather than guessing a fixed delay — the server keeps processing a
// message:send after the sending socket has already disconnected (the
// handler doesn't check socket.connected before persisting), so the test
// needs a deterministic way to know persistence actually finished.
async function waitForMessage(conversationId, clientMessageId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await Message.findOne({ conversationId, clientMessageId });
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Message never persisted within the timeout.');
}

describe('Reconnection, offline sync & idempotency (M9)', () => {
  // TESTING.md #3 — a client can't distinguish "the server never got my
  // send" from "it got it but the ack was lost" after a disconnect, so it
  // must be safe to retry with the identical clientMessageId once
  // reconnected. The server-side persistence already happened despite the
  // original socket going away — see REALTIME.md §13.
  it('a client that disconnects before its ack arrives can safely retry the identical send after reconnecting (TESTING.md #3)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket1 = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket1);

    const clientMessageId = randomUUID();
    // Fire-and-forget: never awaits the ack, then disconnects immediately —
    // simulating the ack being lost to the drop rather than actually
    // failing to send.
    socket1.emit('message:send', { conversationId, clientMessageId, text: 'retry-safe' });
    socket1.close();

    await waitForMessage(conversationId, clientMessageId);
    expect(await Message.countDocuments({ conversationId, clientMessageId })).toBe(1);

    const socket2 = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket2);

    const retryAck = await emitAck(socket2, 'message:send', {
      conversationId,
      clientMessageId,
      text: 'retry-safe',
    });

    expect(retryAck.ok).toBe(true);
    expect(await Message.countDocuments({ conversationId, clientMessageId })).toBe(1);

    socket2.close();
  });

  // TESTING.md #2 — the recipient has no socket connected at all when the
  // message is sent; it must persist as `sent` and become visible to them
  // through the durable history path once they show up.
  it('a message sent while the recipient is entirely offline persists as status:sent and is visible once they connect (TESTING.md #2)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const ack = await emitAck(socket, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'while you were offline',
    });
    expect(ack.ok).toBe(true);
    expect(ack.message.status).toBe('sent');

    // b never had a socket open for any of this — connects only now, to
    // fetch history the ordinary way.
    const historyRes = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Cookie', [b.authCookie]);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.messages).toHaveLength(1);
    expect(historyRes.body.messages[0].status).toBe('sent');

    socket.close();
  });

  // TESTING.md #6 — the full reconnection flow: a client that was connected,
  // drops, and reconnects must recover exactly what it missed (no more, no
  // less) via the after-cursor sync (REALTIME.md §19), with zero duplicates
  // against what it already had.
  it('a reconnecting client recovers exactly the messages it missed via after-sync, with no duplicates (TESTING.md #6)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    const socketA = connectSocket(server.url, a.authCookie);
    const socketB1 = connectSocket(server.url, b.authCookie);
    await Promise.all([waitForConnectOrError(socketA), waitForConnectOrError(socketB1)]);
    await emitAck(socketB1, 'conversation:join', { conversationId });

    // B's "last known message" before it drops.
    const seenAck = await emitAck(socketA, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'seen-before-disconnect',
    });
    expect(seenAck.ok).toBe(true);

    // B drops (network interruption). A keeps sending while B is away.
    socketB1.close();

    const missed1 = await emitAck(socketA, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'missed-1',
    });
    const missed2 = await emitAck(socketA, 'message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      text: 'missed-2',
    });
    expect(missed1.ok).toBe(true);
    expect(missed2.ok).toBe(true);

    // B reconnects: new socket, re-joins the room (REALTIME.md §18 step 2),
    // then runs the after-cursor sync anchored on the last message it had.
    const socketB2 = connectSocket(server.url, b.authCookie);
    await waitForConnectOrError(socketB2);
    await emitAck(socketB2, 'conversation:join', { conversationId });

    const syncRes = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .query({ after: seenAck.message._id })
      .set('Cookie', [b.authCookie]);

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.messages.map((m) => m.text)).toEqual(['missed-1', 'missed-2']);
    expect(syncRes.body.messages.map((m) => m._id)).toEqual([
      missed1.message._id,
      missed2.message._id,
    ]);

    // No duplicates anywhere: exactly 3 documents total for the conversation.
    expect(await Message.countDocuments({ conversationId })).toBe(3);

    socketA.close();
    socketB2.close();
  });
});
