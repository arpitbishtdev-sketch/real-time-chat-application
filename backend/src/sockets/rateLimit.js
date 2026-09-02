// message:send rate limiting (REALTIME.md §25) — an in-memory token bucket
// keyed per authenticated userId, not per-socket, so multi-tab/device spam
// from the same user is bounded too (§25's explicit requirement). Deferred
// from M5 to this dedicated M10 security pass per PROJECT_SPEC.md M10 task
// 4 — REALTIME.md §25 already documented capacity 20 / refill 2/sec; this
// only wires up the mechanism the doc always specified, no new design.
export function createMessageRateLimiter({ capacity = 20, refillPerSecond = 2 } = {}) {
  const buckets = new Map();

  // Continuous (fractional) refill rather than a discrete per-second tick —
  // avoids needing a background timer per user, and is exact regardless of
  // how irregularly tryConsume() happens to be called.
  function tryConsume(userId) {
    const now = Date.now();
    let bucket = buckets.get(userId);

    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(userId, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  return { tryConsume };
}
