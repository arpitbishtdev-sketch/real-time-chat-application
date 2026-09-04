import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../store/authStore.js';
import { sendMessage as emitMessageSend } from '../sockets/socketClient.js';
import {
  insertLiveMessage,
  reconcileOptimisticMessage,
  setOptimisticMessageStatus,
  patchConversationPreview,
} from '../utils/messageCache.js';

// PROJECT_SPEC.md M14 tasks 3/4/7, FRONTEND.md §10 — optimistic send: the
// message renders immediately with a local clientMessageId (generated
// once per logical send, reused verbatim on retry per REALTIME.md §13's
// idempotency contract) in a `sending` state, then reconciled against the
// server-persisted message from the ack, or flipped to `failed` with a
// retry affordance if the ack errors or never arrives.
export function useMessageSend(conversationId) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?._id);

  function insertOptimisticMessage(clientMessageId, text) {
    const optimisticMessage = {
      _id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId: currentUserId,
      text,
      status: 'sending',
      createdAt: new Date().toISOString(),
    };
    queryClient.setQueryData(['messages', conversationId], (data) =>
      insertLiveMessage(data, optimisticMessage)
    );
  }

  async function emitAndReconcile(clientMessageId, text) {
    let response;
    try {
      response = await emitMessageSend({ conversationId, clientMessageId, text });
    } catch {
      // No ack within the send timeout (REALTIME.md's ack contract) or a
      // mid-flight disconnect — safe to retry with the same
      // clientMessageId regardless of which actually happened (§13).
      queryClient.setQueryData(['messages', conversationId], (data) =>
        setOptimisticMessageStatus(data, clientMessageId, 'failed')
      );
      return;
    }

    if (!response.ok) {
      queryClient.setQueryData(['messages', conversationId], (data) =>
        setOptimisticMessageStatus(data, clientMessageId, 'failed')
      );
      return;
    }

    queryClient.setQueryData(['messages', conversationId], (data) =>
      reconcileOptimisticMessage(data, clientMessageId, response.message)
    );
    queryClient.setQueryData(['conversations'], (data) =>
      patchConversationPreview(data, conversationId, {
        lastMessageAt: response.message.createdAt,
        lastMessagePreview: response.message.text,
      })
    );
  }

  function send(rawText) {
    const text = rawText.trim();
    if (!text) return;

    const clientMessageId = crypto.randomUUID();
    insertOptimisticMessage(clientMessageId, text);
    emitAndReconcile(clientMessageId, text);
  }

  function retry(message) {
    queryClient.setQueryData(['messages', conversationId], (data) =>
      setOptimisticMessageStatus(data, message.clientMessageId, 'sending')
    );
    emitAndReconcile(message.clientMessageId, message.text);
  }

  return { send, retry };
}
