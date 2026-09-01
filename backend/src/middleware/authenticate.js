import { verifyAccessToken } from '../utils/tokens.js';
import { AppError } from '../utils/AppError.js';

export function authenticate(req, res, next) {
  const token = req.cookies?.accessToken;

  if (!token) {
    return next(new AppError(401, 'NO_TOKEN', 'Authentication required.'));
  }

  try {
    const decoded = verifyAccessToken(token);
    req.userId = decoded.sub;
    return next();
  } catch {
    // Invalid signature or expired — the frontend interprets this as
    // "attempt refresh" (BACKEND.md §6). Never echo the underlying JWT
    // error detail back to the client.
    return next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired access token.'));
  }
}
