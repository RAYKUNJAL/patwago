'use strict';

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  function check(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - entry.count),
      retryAfterMs: Math.max(0, entry.resetAt - now),
    };
  }

  function _reset() {
    hits.clear();
  }

  return { check, _reset };
}

module.exports = { createRateLimiter };
