import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const PUBLIC_SEARCH_FIELDS = 'displayName avatarUrl statusText';

// Untrusted input reaching a RegExp constructor — escape metacharacters so
// a query like "a.*" can't be used for a broader/slower match than intended.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getCurrentUser(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  return user;
}

export async function updateCurrentUser(userId, updates) {
  const user = await User.findByIdAndUpdate(userId, updates, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  return user;
}

export async function searchUsers(requesterId, { q, limit }) {
  const pattern = new RegExp(escapeRegExp(q), 'i');
  return User.find({ _id: { $ne: requesterId }, displayName: pattern })
    .select(PUBLIC_SEARCH_FIELDS)
    .limit(limit);
}
