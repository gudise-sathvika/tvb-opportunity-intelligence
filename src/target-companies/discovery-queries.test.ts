import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCompanyDiscoveryQueries } from './discovery-queries'

test('profile terms generate bounded queries', () => {
  const queries = buildCompanyDiscoveryQueries({
    companyId: 'C1',
    name: 'Mask NextGen',
    sector: 'product, EdTec, Cyber Security, Al',
    capabilities: ['product', 'EdTec', 'Cyber Security', 'Al'],
  })
  assert.ok(queries.length <= 6)
  assert.ok(queries.some((q) => q.term === 'EdTec'))
})

test('missing profile produces cautious broad fallback', () => {
  const queries = buildCompanyDiscoveryQueries({ companyId: 'C2', name: 'Growth Channel' })
  assert.ok(queries.every((q) => q.term === ''))
  assert.ok(queries.every((q) => /uncertainty/i.test(q.basis)))
})