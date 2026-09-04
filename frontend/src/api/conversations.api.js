import { apiRequest } from './client.js';

function toQueryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function getConversations({ cursor, limit } = {}) {
  return apiRequest(`/api/conversations${toQueryString({ cursor, limit })}`);
}

export function createConversation(participantId) {
  return apiRequest('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ participantId }),
  });
}

// `after` is the reconnection/missed-message-sync direction (BACKEND.md
// §12, REALTIME.md §19) — a raw message id, never combined with `cursor`
// in the same call.
export function getMessages(conversationId, { cursor, limit, after } = {}) {
  return apiRequest(
    `/api/conversations/${conversationId}/messages${toQueryString({ cursor, limit, after })}`
  );
}
