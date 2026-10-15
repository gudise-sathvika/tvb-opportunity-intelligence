import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DISCOVERY_DEMO_PARAM,
  DISCOVERY_DEMO_VALUE,
  isDemoDiscoveryRequest,
  resolveDiscoverySource,
} from './discovery-source'

test('defaults to real mode with no demo flag', () => {
  assert.equal(isDemoDiscoveryRequest(null), false)
  assert.equal(isDemoDiscoveryRequest(undefined), false)
  assert.equal(isDemoDiscoveryRequest(''), false)
  assert.equal(isDemoDiscoveryRequest('0'), false)
  assert.equal(isDemoDiscoveryRequest('true'), false)
  assert.equal(isDemoDiscoveryRequest('demo'), false)

  const s1 = resolveDiscoverySource(null)
  assert.equal(s1.mode, 'real')
  assert.equal(s1.demo, false)

  const s2 = resolveDiscoverySource('1')
  assert.equal(s2.mode, 'demo')
  assert.equal(s2.demo, true)
  assert.equal(s2.mode === 'demo', s2.demo)

  assert.equal(isDemoDiscoveryRequest(DISCOVERY_DEMO_VALUE), true)
  assert.equal(DISCOVERY_DEMO_PARAM, 'demo')
})
