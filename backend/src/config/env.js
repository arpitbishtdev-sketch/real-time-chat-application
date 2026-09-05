import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  })
  .superRefine((data, ctx) => {
    // PROJECT_SPEC.md M18 — production-safe defaults: CLIENT_ORIGIN's
    // dev-convenience default (Vite's default port) would silently
    // misconfigure CORS in production (locked to a localhost origin no real
    // client uses) instead of failing loudly at boot the way every other
    // required production value here already does. Checked against
    // process.env directly rather than data.CLIENT_ORIGIN, since Zod has
    // already applied the default by the time a superRefine runs.
    if (data.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIENT_ORIGIN'],
        message: 'CLIENT_ORIGIN must be explicitly set in production (no safe default).',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid or missing environment configuration:\n${details}`);
  process.exit(1);
}

const data = parsed.data;
const isProduction = data.NODE_ENV === 'production';

export const env = {
  nodeEnv: data.NODE_ENV,
  isProduction,
  port: data.PORT,
  mongoUri: data.MONGODB_URI,
  clientOrigin: data.CLIENT_ORIGIN,
  jwt: {
    accessSecret: data.JWT_ACCESS_SECRET,
    refreshSecret: data.JWT_REFRESH_SECRET,
  },
  cookie: {
    // Secure cookies require HTTPS, which local dev doesn't use.
    secure: isProduction,
    sameSite: 'strict',
    httpOnly: true,
  },
};
