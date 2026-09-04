import { describe, it, expect, vi, beforeEach } from 'vitest';

import { apiRequest, ApiError, onAuthExpired } from '../src/api/client.js';

// PROJECT_SPEC.md M12 task 7 / acceptance criterion — the silent
// refresh-and-retry flow lives in api/client.js (built in M11) and is what
// makes an expired access token invisible to the user. Exercised directly
// against a mocked `fetch` here since it's transport-layer behavior, not
// anything a rendered page asserts on.
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed body on a successful request', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await apiRequest('/api/users/me');

    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/users/me',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('silently refreshes and retries once after a 401, returning the retried result', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Expired' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { _id: '1' } }));

    const result = await apiRequest('/api/users/me');

    expect(result).toEqual({ user: { _id: '1' } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(globalThis.fetch.mock.calls[2][0]).toBe('/api/users/me');
  });

  it('surfaces the original 401 and fires auth:expired when the refresh itself fails', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Expired' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'INVALID_REFRESH', message: 'Bad' } }));

    const expiredHandler = vi.fn();
    const unsubscribe = onAuthExpired(expiredHandler);

    await expect(apiRequest('/api/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });

    expect(expiredHandler).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('never retries the refresh call itself, even on a 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'INVALID_REFRESH' } }));

    await expect(apiRequest('/api/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
