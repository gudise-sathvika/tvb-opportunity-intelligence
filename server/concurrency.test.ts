import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConcurrencyGate } from './concurrency'

test('rejects a non-positive or fractional limit', () => {
  assert.throws(() => new ConcurrencyGate(0))
  assert.throws(() => new ConcurrencyGate(-1))
  assert.throws(() => new ConcurrencyGate(1.5))
})

test('grants at most `max` slots and refuses the rest without queueing', () => {
  const gate = new ConcurrencyGate(2)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), false)
  assert.equal(gate.inFlight, 2)
})

test('releasing frees a slot for the next caller', () => {
  const gate = new ConcurrencyGate(1)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), false)
  gate.release()
  assert.equal(gate.inFlight, 0)
  assert.equal(gate.tryAcquire(), true)
})

test('an unbalanced release never drives the counter negative', () => {
  const gate = new ConcurrencyGate(1)
  gate.release()
  gate.release()
  assert.equal(gate.inFlight, 0)
})
