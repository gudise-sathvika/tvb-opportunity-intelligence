import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FixedWindowRateLimiter } from './rate-limit'

test('allows exactly `max` requests and rejects the next within the window', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 3, maxKeys: 10 })
  const at0 = limiter.check('client', 0)
  assert.deepEqual(at0, { allowed: true, remaining: 2, retryAfterMs: 0 })
  assert.equal(limiter.check('client', 1).allowed, true)
  const third = limiter.check('client', 2)
  assert.equal(third.allowed, true)
  assert.equal(third.remaining, 0)

  const fourth = limiter.check('client', 3)
  assert.equal(fourth.allowed, false)
  assert.equal(fourth.retryAfterMs, 997)
})

test('resets the window once it has elapsed', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1, maxKeys: 10 })
  assert.equal(limiter.check('client', 0).allowed, true)
  assert.equal(limiter.check('client', 500).allowed, false)
  assert.equal(limiter.check('client', 1000).allowed, true)
})

test('scopes limits per client key', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1, maxKeys: 10 })
  assert.equal(limiter.check('a', 0).allowed, true)
  assert.equal(limiter.check('b', 0).allowed, true)
  assert.equal(limiter.check('a', 0).allowed, false)
})

test('keeps memory bounded by evicting the oldest key at capacity', () => {
  const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1, maxKeys: 3 })
  for (const key of ['a', 'b', 'c', 'd', 'e']) limiter.check(key, 0)
  assert.equal(limiter.trackedKeys, 3)
  assert.ok(limiter.trackedKeys <= 3)
})
