import { apiRequest } from './client.js';

export function getMe() {
  return apiRequest('/api/users/me');
}

export function searchUsers(q, limit = 20) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiRequest(`/api/users/search?${params.toString()}`);
}
