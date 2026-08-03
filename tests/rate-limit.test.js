'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../lib/rate-limit');

test('rate limiter allows requests under max', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(limiter.check('ip:1').allowed, true);
  assert.equal(limiter.check('ip:1').allowed, true);
  assert.equal(limiter.check('ip:1').allowed, true);
});

test('rate limiter blocks requests over max', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(limiter.check('ip:1').allowed, true);
  assert.equal(limiter.check('ip:1').allowed, true);
  const blocked = limiter.check('ip:1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0);
});

test('rate limiter tracks independent keys separately', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.check('ip:1').allowed, true);
  assert.equal(limiter.check('ip:2').allowed, true);
  assert.equal(limiter.check('ip:1').allowed, false);
});

test('rate limiter can reset its window state', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.check('ip:1').allowed, true);
  assert.equal(limiter.check('ip:1').allowed, false);
  limiter._reset();
  assert.equal(limiter.check('ip:1').allowed, true);
});
