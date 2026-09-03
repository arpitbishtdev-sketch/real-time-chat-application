// Thin fetch wrapper (FRONTEND.md §5) — every call goes through here so no
// component or query hook needs to know about credentials, error-envelope
// parsing, or the refresh-and-retry flow. Paths are relative (`/api/...`):
// in dev, vite.config.js proxies them to the backend; a production base
// URL is a deployment concern (M18), not yet needed.

const AUTH_EXPIRED_EVENT = 'auth:expired';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Store-agnostic notification hook: client.js never imports the auth store
// directly (auth.api.js already imports client.js, so the reverse import
// would be circular) — authStore subscribes to this event instead.
export function onAuthExpired(handler) {
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

function notifyAuthExpired() {
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function parseErrorBody(res) {
  try {
    const body = await res.json();
    return body?.error ?? null;
  } catch {
    return null;
  }
}

async function rawRequest(path, options) {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (res.ok) {
    if (res.status === 204) {
      return null;
    }
    return res.json().catch(() => null);
  }

  const errorBody = await parseErrorBody(res);
  throw new ApiError(
    res.status,
    errorBody?.code ?? 'UNKNOWN_ERROR',
    errorBody?.message ?? 'Something went wrong. Please try again.',
    errorBody?.details
  );
}

let refreshPromise = null;

// Concurrent 401s share a single in-flight refresh instead of each firing
// their own — otherwise a page that fires several requests at once (e.g.
// on initial load) could race multiple refresh calls against the same
// refresh token.
function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = rawRequest('/api/auth/refresh', { method: 'POST' }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// call(url, opts) → 401 → POST /auth/refresh once → retry original call
// once → if still 401, notify + surface the original failure (FRONTEND.md
// §5). Never retries the refresh call itself, and never retries more than
// once per original call.
export async function apiRequest(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (err) {
    const isAuthFailure = err instanceof ApiError && err.status === 401;
    const isRefreshCall = path === '/api/auth/refresh';

    if (!isAuthFailure || isRefreshCall || options._isRetry) {
      if (isAuthFailure) {
        notifyAuthExpired();
      }
      throw err;
    }

    try {
      await refreshOnce();
    } catch {
      notifyAuthExpired();
      throw err;
    }

    return apiRequest(path, { ...options, _isRetry: true });
  }
}
