import { env } from '../config/env.js';
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from './tokens.js';

// Resolved 2026-09-01: BACKEND.md §6 originally scoped this cookie to
// /api/auth/refresh only, but §6a/§15 require /api/auth/logout and
// /api/auth/logout-all to also read it (to find the caller's `sid`) —
// a cookie scoped that narrowly is never sent by the browser on those
// paths, so logout could never identify which Session to delete. Broadened
// to /api/auth, which still excludes it from every non-auth REST call
// (the actual isolation §6 cares about) while reaching the handful of
// auth endpoints that legitimately need it.
const REFRESH_COOKIE_PATH = '/api/auth';
export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie('accessToken', accessToken, {
    httpOnly: env.cookie.httpOnly,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite,
    maxAge: ACCESS_TOKEN_TTL_MS,
    path: '/',
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: env.cookie.httpOnly,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite,
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: REFRESH_COOKIE_PATH,
  });
}

export function setAccessCookie(res, accessToken) {
  res.cookie('accessToken', accessToken, {
    httpOnly: env.cookie.httpOnly,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite,
    maxAge: ACCESS_TOKEN_TTL_MS,
    path: '/',
  });
}

export function clearAuthCookies(res) {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
}
