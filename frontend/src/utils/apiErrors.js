import { ApiError } from '../api/client.js';

// Turns a rejected auth API call into form-shaped feedback. Field errors
// come from two backend error codes that are inherently about one field:
// VALIDATION_ERROR's `details` (backend/src/middleware/validate.js's
// {path, message} array, path === the Zod field name) and EMAIL_TAKEN
// (register only) mapped onto `email`. Everything else — INVALID_CREDENTIALS,
// RATE_LIMITED, a plain network failure — is a form-level message instead,
// since it isn't about any single input.
export function fieldErrorsFromApiError(err) {
  if (!(err instanceof ApiError)) return {};

  if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    return Object.fromEntries(err.details.map((detail) => [detail.path, detail.message]));
  }

  if (err.code === 'EMAIL_TAKEN') {
    return { email: err.message };
  }

  return {};
}

export function formErrorFromApiError(err) {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' || err.code === 'EMAIL_TAKEN') return null;
    return err.message;
  }
  // Not an ApiError at all — fetch itself failed (offline, DNS, CORS, etc.)
  // before a response ever came back to parse.
  return 'Network error. Please check your connection and try again.';
}
