import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(50).optional(),
  avatarUrl: z.url().optional(),
  statusText: z.string().trim().max(100).optional(),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
