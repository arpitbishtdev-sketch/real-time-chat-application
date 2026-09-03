import { apiRequest } from './client.js';

export function register(payload) {
  return apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
}

export function login(payload) {
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export function logoutAll() {
  return apiRequest('/api/auth/logout-all', { method: 'POST' });
}
