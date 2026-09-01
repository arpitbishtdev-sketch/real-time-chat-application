import { z } from 'zod';

// Password policy (no length/complexity rule was specified in BACKEND.md —
// resolved here): min 8 chars per OWASP's minimum baseline, max 72 bytes
// because bcrypt silently truncates/ignores input beyond 72 bytes, which
// would otherwise let two different long passwords hash identically.
const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(8, 'Password must be at least 8 characters').max(72);
const displayName = z.string().trim().min(2).max(50);

export const registerSchema = z.object({
  email,
  password,
  displayName,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});
