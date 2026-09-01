import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { connect, disconnect, clearDatabase } from '../helpers/mongoMemory.js';
import { registerUser } from '../helpers/testUsers.js';
import { startTestServer, connectSocket, waitForConnectOrError } from '../helpers/testServer.js';
import { assertParticipant } from '../../src/services/conversation.service.js';

// Delays the real membership check so a test can control exactly when it
// resolves relative to a competing conversation:leave — this is what
// makes the "latest intent wins" race (REALTIME.md §7, TESTING.md #27)
// reproducible on demand instead of hoping for a timing coincidence.
vi.mock('../../src/services/conversation.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, assertParticipant: vi.fn(actual.assertParticipant) };
});

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
  vi.mocked(assertParticipant).mockRestore();
});

async function createConversation(a, b) {
  const res = await request(app)
    .post('/api/conversations')
    .set('Cookie', [a.authCookie])
    .send({ participantId: b.user._id });
  return res.body.conversation._id;
}

describe('conversation:join / conversation:leave race — "latest intent wins" (TESTING.md #27)', () => {
  it('a leave that completes while an earlier join check is in flight is not overridden by the stale join', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    let releaseCheck;
    const gate = new Promise((resolve) => {
      releaseCheck = resolve;
    });
    const realAssertParticipant = (
      await vi.importActual('../../src/services/conversation.service.js')
    ).assertParticipant;
    vi.mocked(assertParticipant).mockImplementation(async (...args) => {
      await gate;
      return realAssertParticipant(...args);
    });

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    const joinAck = new Promise((resolve) => {
      socket.emit('conversation:join', { conversationId }, resolve);
    });

    socket.emit('conversation:leave', { conversationId });

    // Wait deterministically until the leave has actually been processed
    // server-side (intent flipped to 'leave') before releasing the gated
    // membership check — a fixed timeout would be a guess about transport
    // latency, not a proof the race was actually set up.
    const key = `${socket.id}:${conversationId}`;
    await vi.waitFor(() => {
      if (server.io.conversationIntents.get(key) !== 'leave') {
        throw new Error('leave not yet processed');
      }
    });

    releaseCheck();
    const ack = await joinAck;

    // The membership check itself succeeded (real participant), so the ack
    // reflects that — but the stale join must never have actually joined
    // the room, since a leave superseded it in the meantime.
    expect(ack).toEqual({ ok: true });

    const room = server.io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
    expect(room?.has(socket.id)).toBeFalsy();

    socket.close();
  });

  it('a join that completes after a stale leave-adjacent state re-establishes room membership (join supersedes)', async () => {
    const a = await registerUser(app, { displayName: 'Ada' });
    const b = await registerUser(app, { displayName: 'Bob' });
    const conversationId = await createConversation(a, b);

    vi.mocked(assertParticipant).mockImplementation(
      (await vi.importActual('../../src/services/conversation.service.js')).assertParticipant
    );

    const socket = connectSocket(server.url, a.authCookie);
    await waitForConnectOrError(socket);

    // leave (no-op, never joined) immediately followed by a real join that
    // resolves normally — the newer join must win and the room must be
    // joined at the end.
    socket.emit('conversation:leave', { conversationId });
    const ack = await new Promise((resolve) => {
      socket.emit('conversation:join', { conversationId }, resolve);
    });

    expect(ack).toEqual({ ok: true });
    const room = server.io.sockets.adapter.rooms.get(`conversation:${conversationId}`);
    expect(room?.has(socket.id)).toBe(true);

    socket.close();
  });
});
