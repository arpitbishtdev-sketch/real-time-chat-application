import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  logoutAllSessions,
} from '../services/auth.service.js';
import { setAuthCookies, setAccessCookie, clearAuthCookies } from '../utils/cookies.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await registerUser(req.body);
  setAuthCookies(res, { accessToken, refreshToken });
  res.status(201).json({ user });
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await loginUser(req.body);
  setAuthCookies(res, { accessToken, refreshToken });
  res.status(200).json({ user });
});

export const refresh = asyncHandler(async (req, res) => {
  const { accessToken } = await refreshAccessToken(req.cookies?.refreshToken);
  setAccessCookie(res, accessToken);
  res.status(200).json({ ok: true });
});

export const logout = asyncHandler(async (req, res) => {
  await logoutUser(req.cookies?.refreshToken);
  clearAuthCookies(res);
  res.status(200).json({ ok: true });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  await logoutAllSessions(req.userId, io);
  clearAuthCookies(res);
  res.status(200).json({ ok: true });
});
