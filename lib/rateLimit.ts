type Bucket = { tokens: number; last: number };

declare global {
  var __cv_rl__: Map<string, Bucket> | undefined;
}

// Simple token bucket per key (e.g., IP). No deps, resets on restart.
const buckets: Map<string, Bucket> = globalThis.__cv_rl__ ?? new Map<string, Bucket>();
if (!globalThis.__cv_rl__) globalThis.__cv_rl__ = buckets;

export function allow(key: string, ratePerMin = 60, burst = 60): boolean {
  const now = Date.now();
  const refillMs = 60_000;
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: burst, last: now };
    buckets.set(key, b);
  }
  const elapsed = now - b.last;
  const refill = (elapsed / refillMs) * ratePerMin;
  b.tokens = Math.min(burst, b.tokens + refill);
  b.last = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}
