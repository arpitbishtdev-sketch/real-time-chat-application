import rateLimit from 'express-rate-limit';

function rateLimitedResponse(req, res) {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  });
}

function makeLimiter(limit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedResponse,
  });
}

// A factory, not module-level singletons: express-rate-limit's default
// store lives inside the middleware instance it returns, so building
// these fresh per createApp() call is what makes each app instance's
// rate-limit state actually independent (load-bearing for test isolation
// — see tests/integration/auth.ratelimit.test.js — and correct in
// production too, where createApp() is still only ever called once).
export function createAuthRateLimiters() {
  return {
    // Two independent limiters (BACKEND.md §10) — register and login each
    // get their own 10/15min/IP budget, not a combined one.
    registerRateLimiter: makeLimiter(10),
    loginRateLimiter: makeLimiter(10),
    refreshRateLimiter: makeLimiter(30),
  };
}
