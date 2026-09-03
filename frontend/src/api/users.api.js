import { apiRequest } from './client.js';

export function getMe() {
  return apiRequest('/api/users/me');
}
