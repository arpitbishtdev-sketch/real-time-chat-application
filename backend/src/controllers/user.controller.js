import { getCurrentUser, updateCurrentUser, searchUsers } from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getMe = asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req.userId);
  res.status(200).json({ user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await updateCurrentUser(req.userId, req.body);
  res.status(200).json({ user });
});

export const search = asyncHandler(async (req, res) => {
  const users = await searchUsers(req.userId, req.validatedQuery);
  res.status(200).json({ users });
});
