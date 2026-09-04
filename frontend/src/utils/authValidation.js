// Client-side mirror of backend/src/validation/auth.schema.js's Zod rules —
// mirrors, never replaces (FRONTEND.md §19 / PROJECT_SPEC.md M12 task 5):
// the server re-validates everything here regardless of what the client
// already checked.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required.';
  if (!EMAIL_RE.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

// Login only checks presence — the server is the sole source of truth on
// whether a given password is *correct*, and echoing the registration
// length rule here would wrongly imply a short input is the reason a
// legitimate account's login failed.
export function validateLoginPassword(value) {
  if (!value) return 'Password is required.';
  return null;
}

export function validateNewPassword(value) {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

export function validateDisplayName(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Display name is required.';
  if (trimmed.length < 2) return 'Display name must be at least 2 characters.';
  if (trimmed.length > 50) return 'Display name must be 50 characters or fewer.';
  return null;
}
