/**
 * Phase T — controlled Vault writer tests.
 *
 * Every test runs against a fresh `mkdtemp` vault under the OS temp directory;
 * the production vault is never touched, never read, and never asserted on.
 * The suite proves the 19 brief requirements: one happy write per supported
 * type, every rejection rule, conflict/idempotency behaviour, atomicity,
 * determinism, provenance, dry-run parity, no network, and (in
 * `boundary.test.ts`) that no unrelated module can write.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import YAML from 'yaml'
import { previewVaultWrite, writeVaultRecord, WRITABLE_RECORD_TYPES } from './writer'
import * as writerModule from './writer'
import type { VaultWriteApproval, VaultWriteRequest } from './writer'

const APPROVAL: VaultWriteApproval = {
  decisionId: 'RVW-100',
  approvedBy: 'RVW-100',
  decidedAt: '2026-10-10',
}

const SEEDS: readonly (readonly [string, string])[] = [
  ['01 - Opportunities', 'OPP-001 — Seed Fund Scheme.md'],
  ['02 - Companies', 'COMP-001 — AgriSolar Systems Private Limited.md'],
  ['02 - Companies', 'COMP-003 — Sarva Jal Water Solutions.md'],
  ['05 - Organizations', 'ORG-001 — DPIIT.md'],
  ['06 - Sources', 'SRC-001 — Fixture Source.md'],
  ['09 - Notices', 'RFB-001 — Rooftop Solar Works Framework.md'],
]

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-writer-'))
  for (const [dir, file] of SEEDS) {
    const abs = path.join(root, dir)
    fs.mkdirSync(abs, { recursive: true })
    fs.writeFileSync(path.join(abs, file), `---\nseed: true\n---\n\n# seed\n`, 'utf8')
  }
  return root
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(abs, out)
    else if (entry.name.endsWith('.md')) out.push(abs)
  }
  return out
}

function frontmatterOf(abs: string): Record<string, unknown> {
  const text = fs.readFileSync(abs, 'utf8')
  assert.ok(text.startsWith('---\n'), `${path.basename(abs)} starts with frontmatter`)
  const end = text.indexOf('\n---\n', 4)
  assert.ok(end > 0, `${path.basename(abs)} closes its frontmatter`)
  return YAML.parse(text.slice(4, end)) as Record<string, unknown>
}

function opportunityPayload(): Record<string, unknown> {
  return {
    opportunity_id: 'OPP-700',
    opportunity_name: 'Community Solar Innovation Grant FY2027',
    opportunity_type: 'Grant',
    description: 'Fixture grant used by the controlled writer tests.',
    provider: '[[ORG-001 — DPIIT]]',
    country: 'India',
    verification_status: 'Unverified',
    last_verified: '2026-10-08',
    record_status: 'Active',
    notes: 'Proposed from approved review RVW-100, approved by RVW-100 at 2026-10-10.',
  }
}

function noticePayload(): Record<string, unknown> {
  return {
    notice_id: 'RFB-700',
    notice_name: 'Rooftop Solar Installation Works FY2027',
    notice_number: 'RFP-2026-042',
    notice_type: 'RFP',
    procurement_method: 'Open',
    procuring_entity: '[[ORG-001 — DPIIT]]',
    notice_url: 'https://fixture.invalid/rfp-2026-042',
    country: 'India',
    description: 'Fixture notice used by the controlled writer tests.',
    contract_type: 'Works',
    lot_structure: 'Single lot',
    issue_date: '2026-10-01',
    notice_status: 'Published',
  }
}

function matchPayload(): Record<string, unknown> {
  return {
    match_id: 'MATCH-700',
    company: '[[COMP-003 — Sarva Jal Water Solutions]]',
    opportunity: '[[OPP-001 — Seed Fund Scheme]]',
    match_status: 'New',
    eligibility_status: 'Not assessed',
    evidence_notes:
      'Match proposal MP:MATCH-RULES-v1:OPP-001:COMP-003 (MATCH-RULES-v1): 2 matched signals. Approved by RVW-100 at 2026-10-10.',
    reviewed_by: 'RVW-100',
    review_date: '2026-10-10',
  }
}

function procurementMatchPayload(): Record<string, unknown> {
  return {
    procurement_match_id: 'PMATCH-700',
    notice: '[[RFB-001 — Rooftop Solar Works Framework]]',
    company: '[[COMP-001 — AgriSolar Systems Private Limited]]',
    match_status: 'New',
    eligibility_status: 'Not assessed',
    evidence_notes:
      'Procurement match proposal PP:PMATCH-RULES-v1:RFB-001:COMP-001 (PMATCH-RULES-v1): approved by RVW-200 at 2026-10-15.',
    reviewed_by: 'RVW-200',
    review_date: '2026-10-15',
  }
}

function bidPayload(): Record<string, unknown> {
  return {
    bid_id: 'BID-700',
    company: '[[COMP-001 — AgriSolar Systems Private Limited]]',
    notice: '[[RFB-001 — Rooftop Solar Works Framework]]',
    eligibility_status: 'Not assessed',
    bid_decision: 'Bid',
    bid_decision_date: '2026-10-15',
    decided_by: 'RVW-300',
    bid_status: 'Researching',
    evidence_notes:
      'Bid proposal derived from APPROVED procurement match PP:PMATCH-RULES-v1:RFB-001:COMP-001 (PMATCH-RULES-v1). Human bid decision BID by RVW-300 at 2026-10-15.',
  }
}

function request(
  recordType: string,
  recordId: string,
  payload: Record<string, unknown>,
  approval: VaultWriteApproval | null = APPROVAL,
): VaultWriteRequest {
  return { recordType, recordId, payload, approval }
}

/* 1 — approved Opportunity ------------------------------------------------ */

test('1. an approved Opportunity proposal writes correctly', () => {
  const root = makeVault()
  try {
    const result = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CREATED')
    assert.equal(result.recordType, 'opportunity')
    assert.equal(result.recordId, 'OPP-700')
    assert.equal(
      result.targetPath,
      '01 - Opportunities/OPP-700 — Community Solar Innovation Grant FY2027.md',
    )
    assert.deepEqual(result.errors, [])

    const abs = path.join(root, result.targetPath as string)
    assert.ok(fs.existsSync(abs))
    const fm = frontmatterOf(abs)
    assert.equal(fm.opportunity_id, 'OPP-700')
    assert.equal(fm.opportunity_type, 'Grant')
    assert.equal(fm.country, 'India')
    assert.equal(fm.record_status, 'Active')

    const text = fs.readFileSync(abs, 'utf8')
    assert.ok(text.includes('# Community Solar Innovation Grant FY2027'))
    assert.ok(
      text.trimEnd().endsWith('*Field definitions and controlled values: [[Data Dictionary]]*'),
      'the standard footer is present',
    )
    assert.ok(
      text.indexOf('opportunity_id:') < text.indexOf('opportunity_name:'),
      'frontmatter keeps schema key order',
    )
  } finally {
    cleanup(root)
  }
})

/* 2 — approved Notice ----------------------------------------------------- */

test('2. an approved Notice proposal writes correctly', () => {
  const root = makeVault()
  try {
    const result = writeVaultRecord(request('notice', 'RFB-700', noticePayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CREATED')
    assert.equal(result.recordType, 'notice')
    assert.equal(result.targetPath, '09 - Notices/RFB-700 — Rooftop Solar Installation Works FY2027.md')

    const fm = frontmatterOf(path.join(root, '09 - Notices', 'RFB-700 — Rooftop Solar Installation Works FY2027.md'))
    assert.equal(fm.notice_id, 'RFB-700')
    assert.equal(fm.notice_type, 'RFP')
    assert.equal(fm.lot_structure, 'Single lot')
    assert.equal(fm.procuring_entity, '[[ORG-001 — DPIIT]]')
  } finally {
    cleanup(root)
  }
})

/* 3 — approved Match ------------------------------------------------------ */

test('3. an approved Match proposal writes correctly', () => {
  const root = makeVault()
  try {
    const result = writeVaultRecord(request('match', 'MATCH-700', matchPayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CREATED')
    assert.equal(result.targetPath, '03 - Matches/MATCH-700.md')
    const fm = frontmatterOf(path.join(root, '03 - Matches', 'MATCH-700.md'))
    assert.equal(fm.match_id, 'MATCH-700')
    assert.equal(fm.company, '[[COMP-003 — Sarva Jal Water Solutions]]')
    assert.equal(fm.opportunity, '[[OPP-001 — Seed Fund Scheme]]')
    assert.equal(fm.match_status, 'New')
  } finally {
    cleanup(root)
  }
})

/* 4 — approved ProcurementMatch ------------------------------------------ */

test('4. an approved ProcurementMatch proposal writes into the reserved folder', () => {
  const root = makeVault()
  try {
    assert.ok(!fs.existsSync(path.join(root, '12 - Procurement Matches')), 'folder starts absent')
    const result = writeVaultRecord(
      request('procurement_match', 'PMATCH-700', procurementMatchPayload()),
      { vaultRoot: root },
    )
    assert.equal(result.status, 'CREATED')
    assert.equal(result.targetPath, '12 - Procurement Matches/PMATCH-700.md')
    assert.ok(fs.existsSync(path.join(root, '12 - Procurement Matches', 'PMATCH-700.md')))
    const fm = frontmatterOf(path.join(root, '12 - Procurement Matches', 'PMATCH-700.md'))
    assert.equal(fm.procurement_match_id, 'PMATCH-700')
    assert.equal(fm.notice, '[[RFB-001 — Rooftop Solar Works Framework]]')
  } finally {
    cleanup(root)
  }
})

/* 5 — approved Bid -------------------------------------------------------- */

test('5. an approved Bid proposal writes correctly', () => {
  const root = makeVault()
  try {
    const result = writeVaultRecord(request('bid', 'BID-700', bidPayload()), { vaultRoot: root })
    assert.equal(result.status, 'CREATED')
    assert.equal(result.targetPath, '10 - Bids/BID-700.md')
    const fm = frontmatterOf(path.join(root, '10 - Bids', 'BID-700.md'))
    assert.equal(fm.bid_id, 'BID-700')
    assert.equal(fm.bid_decision, 'Bid')
    assert.equal(fm.bid_status, 'Researching')
    assert.equal(fm.decided_by, 'RVW-300')
    assert.equal(fm.contract_id, undefined, 'no Contract fields are invented')
  } finally {
    cleanup(root)
  }
})

/* 6 — non-approved proposal ---------------------------------------------- */

test('6. a non-approved proposal is rejected and writes nothing', () => {
  const root = makeVault()
  try {
    const before = walkMarkdown(root).length
    const variants: readonly unknown[] = [
      { recordType: 'opportunity', recordId: 'OPP-700', payload: opportunityPayload() },
      { recordType: 'opportunity', recordId: 'OPP-700', payload: opportunityPayload(), approval: null },
      {
        recordType: 'opportunity',
        recordId: 'OPP-700',
        payload: opportunityPayload(),
        approval: { decisionId: '', approvedBy: '', decidedAt: '' },
      },
      {
        recordType: 'opportunity',
        recordId: 'OPP-700',
        payload: opportunityPayload(),
        approval: { decisionId: 'RVW-1', approvedBy: 'RVW-1', decidedAt: 'yesterday' },
      },
    ]
    for (const variant of variants) {
      const result = writeVaultRecord(variant, { vaultRoot: root })
      assert.equal(result.status, 'REJECTED', `approval ${JSON.stringify(variant)} must be rejected`)
      assert.ok(result.errors.some((error) => error.code === 'not_approved'))
    }
    assert.equal(walkMarkdown(root).length, before, 'no file was written')
  } finally {
    cleanup(root)
  }
})

/* 7 — missing required field --------------------------------------------- */

test('7. a proposal with a missing required field is rejected', () => {
  const root = makeVault()
  try {
    const payload = opportunityPayload()
    delete payload.country
    const result = writeVaultRecord(request('opportunity', 'OPP-700', payload), { vaultRoot: root })
    assert.equal(result.status, 'REJECTED')
    assert.ok(result.errors.some((e) => e.code === 'missing_required_field' && e.field === 'country'))
    assert.equal(walkMarkdown(root).length, SEEDS.length)
  } finally {
    cleanup(root)
  }
})

/* 8 — invalid controlled value ------------------------------------------- */

test('8. an invalid controlled value is rejected', () => {
  const root = makeVault()
  try {
    const payload = opportunityPayload()
    payload.record_status = 'Almost Active'
    const result = writeVaultRecord(request('opportunity', 'OPP-700', payload), { vaultRoot: root })
    assert.equal(result.status, 'REJECTED')
    assert.ok(result.errors.some((e) => e.code === 'invalid_controlled_value' && e.field === 'record_status'))
    assert.equal(walkMarkdown(root).length, SEEDS.length)
  } finally {
    cleanup(root)
  }
})

/* 9 — invalid relationships ----------------------------------------------- */

test('9. an invalid or unresolved relationship is rejected', () => {
  const root = makeVault()
  try {
    const before = walkMarkdown(root).length

    const missing = opportunityPayload()
    missing.provider = '[[ORG-999 — Ghost Organization]]'
    const missingResult = writeVaultRecord(request('opportunity', 'OPP-700', missing), {
      vaultRoot: root,
    })
    assert.equal(missingResult.status, 'REJECTED')
    assert.ok(missingResult.errors.some((e) => e.code === 'unresolved_relationship'))

    const wrongType = matchPayload()
    wrongType.company = '[[OPP-001 — Seed Fund Scheme]]'
    const wrongTypeResult = writeVaultRecord(request('match', 'MATCH-700', wrongType), {
      vaultRoot: root,
    })
    assert.equal(wrongTypeResult.status, 'REJECTED')
    assert.ok(wrongTypeResult.errors.some((e) => e.code === 'invalid_relationship'))

    const malformed = noticePayload()
    malformed.procuring_entity = 'ORG-001 DPIIT'
    const malformedResult = writeVaultRecord(request('notice', 'RFB-700', malformed), {
      vaultRoot: root,
    })
    assert.equal(malformedResult.status, 'REJECTED')
    assert.ok(malformedResult.errors.some((e) => e.code === 'invalid_relationship'))

    assert.equal(walkMarkdown(root).length, before, 'no file was written')
  } finally {
    cleanup(root)
  }
})

/* 10 — identical duplicate ------------------------------------------------ */

test('10. an identical existing record returns ALREADY_EXISTS (no-op)', () => {
  const root = makeVault()
  try {
    const first = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(first.status, 'CREATED')
    const abs = path.join(root, first.targetPath as string)
    const afterFirst = fs.readFileSync(abs)

    const second = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(second.status, 'ALREADY_EXISTS')
    assert.deepEqual(second.errors, [])
    assert.deepEqual(fs.readFileSync(abs), afterFirst, 'the file is untouched')
    assert.equal(walkMarkdown(root).length, SEEDS.length + 1, 'no second file appears')
  } finally {
    cleanup(root)
  }
})

/* 11 — different duplicate ------------------------------------------------ */

test('11. an existing record with different content returns CONFLICT and is not overwritten', () => {
  const root = makeVault()
  try {
    const first = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(first.status, 'CREATED')
    const abs = path.join(root, first.targetPath as string)
    const original = fs.readFileSync(abs)

    const changed = opportunityPayload()
    changed.description = 'Different content for the same record ID.'
    const second = writeVaultRecord(request('opportunity', 'OPP-700', changed), { vaultRoot: root })
    assert.equal(second.status, 'CONFLICT')
    assert.ok(second.errors.some((e) => e.code === 'content_mismatch'))
    assert.deepEqual(fs.readFileSync(abs), original, 'the original file is byte-identical')
    assert.equal(walkMarkdown(root).length, SEEDS.length + 1)
  } finally {
    cleanup(root)
  }
})

test('11b. the same ID filed under another filename is also CONFLICT', () => {
  const root = makeVault()
  try {
    const otherName = path.join(root, '01 - Opportunities', 'OPP-700 — An earlier name.md')
    fs.writeFileSync(otherName, '---\nold: true\n---\n\n# old\n', 'utf8')
    const result = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CONFLICT')
    assert.ok(result.errors.some((e) => e.code === 'duplicate_record_id'))
    assert.equal(fs.readFileSync(otherName, 'utf8'), '---\nold: true\n---\n\n# old\n')
  } finally {
    cleanup(root)
  }
})

/* 12 — malformed proposals ------------------------------------------------ */

test('12. malformed proposals are rejected and write nothing', () => {
  const root = makeVault()
  try {
    const before = walkMarkdown(root).length

    const notAnObject = writeVaultRecord('nope', { vaultRoot: root })
    assert.equal(notAnObject.status, 'REJECTED')
    assert.ok(notAnObject.errors.some((e) => e.code === 'malformed_request'))

    const unsupported = writeVaultRecord(request('contract', 'CON-700', {}), { vaultRoot: root })
    assert.equal(unsupported.status, 'REJECTED')
    assert.equal(unsupported.recordType, null)
    assert.ok(unsupported.errors.some((e) => e.code === 'unsupported_record_type'))

    const badId = writeVaultRecord(request('opportunity', 'OPP-7', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(badId.status, 'REJECTED')
    assert.ok(badId.errors.some((e) => e.code === 'invalid_record_id'))

    const badPayload = writeVaultRecord(request('opportunity', 'OPP-700', 'nope' as never), {
      vaultRoot: root,
    })
    assert.equal(badPayload.status, 'REJECTED')
    assert.ok(badPayload.errors.some((e) => e.code === 'malformed_payload'))

    const idMismatch = { ...opportunityPayload(), opportunity_id: 'OPP-701' }
    const mismatch = writeVaultRecord(request('opportunity', 'OPP-700', idMismatch), {
      vaultRoot: root,
    })
    assert.equal(mismatch.status, 'REJECTED')
    assert.ok(mismatch.errors.some((e) => e.code === 'id_field_mismatch'))

    const unknownField = { ...opportunityPayload(), invention: 'not in the schema' }
    const extra = writeVaultRecord(request('opportunity', 'OPP-700', unknownField), {
      vaultRoot: root,
    })
    assert.equal(extra.status, 'REJECTED')
    assert.ok(extra.errors.some((e) => e.code === 'unknown_field' && e.field === 'invention'))

    assert.equal(walkMarkdown(root).length, before, 'zero files were written')
  } finally {
    cleanup(root)
  }
})

/* 13 — serialization failure --------------------------------------------- */

test('13. a serialization failure writes nothing', () => {
  const root = makeVault()
  try {
    const before = walkMarkdown(root).length
    const payload = opportunityPayload()
    let reads = 0
    Object.defineProperty(payload, 'notes', {
      enumerable: true,
      configurable: true,
      get(): string {
        reads += 1
        if (reads > 1) throw new Error('serialization boom')
        return 'provenance on the first read only'
      },
    })
    const result = writeVaultRecord(request('opportunity', 'OPP-700', payload), { vaultRoot: root })
    assert.equal(result.status, 'REJECTED')
    assert.ok(result.errors.some((e) => e.code === 'serialization_failed'))
    assert.equal(walkMarkdown(root).length, before, 'zero files were written')
    assert.ok(!fs.existsSync(path.join(root, '01 - Opportunities', 'OPP-700 — Community Solar Innovation Grant FY2027.md')))
  } finally {
    cleanup(root)
  }
})

/* 14 — deterministic repeated payload ------------------------------------ */

test('14. a repeated payload renders byte-identical Markdown', () => {
  const rootA = makeVault()
  const rootB = makeVault()
  try {
    const preview = previewVaultWrite(request('match', 'MATCH-700', matchPayload()), {
      vaultRoot: rootA,
    })
    assert.equal(preview.status, 'READY')
    const again = previewVaultWrite(request('match', 'MATCH-700', matchPayload()), {
      vaultRoot: rootA,
    })
    assert.equal(again.markdown, preview.markdown, 'preview is deterministic')

    const a = writeVaultRecord(request('match', 'MATCH-700', matchPayload()), { vaultRoot: rootA })
    const b = writeVaultRecord(request('match', 'MATCH-700', matchPayload()), { vaultRoot: rootB })
    assert.equal(a.status, 'CREATED')
    assert.equal(b.status, 'CREATED')
    const bytesA = fs.readFileSync(path.join(rootA, a.targetPath as string))
    const bytesB = fs.readFileSync(path.join(rootB, b.targetPath as string))
    assert.deepEqual(bytesA, bytesB, 'independent vaults get identical bytes')
    assert.equal(bytesA.toString('utf8'), preview.markdown, 'preview equals the written file')
  } finally {
    cleanup(rootA)
    cleanup(rootB)
  }
})

/* 15 — never overwrite ---------------------------------------------------- */

test('15. an existing file is never overwritten, even by a conflicting write', () => {
  const root = makeVault()
  try {
    const abs = path.join(root, '01 - Opportunities', 'OPP-700 — Community Solar Innovation Grant FY2027.md')
    const planted = '---\nplanted: true\n---\n\n# planted\n'
    fs.writeFileSync(abs, planted, 'utf8')
    const result = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CONFLICT')
    assert.equal(fs.readFileSync(abs, 'utf8'), planted, 'the planted file is untouched')
  } finally {
    cleanup(root)
  }
})

/* 16 — provenance --------------------------------------------------------- */

test('16. provenance is preserved in schema-supported fields', () => {
  const root = makeVault()
  try {
    const result = writeVaultRecord(request('match', 'MATCH-700', matchPayload()), {
      vaultRoot: root,
    })
    assert.equal(result.status, 'CREATED')
    const fm = frontmatterOf(path.join(root, result.targetPath as string))
    const payload = matchPayload()
    assert.equal(fm.evidence_notes, payload.evidence_notes)
    assert.equal(fm.reviewed_by, 'RVW-100')
    assert.equal(fm.review_date, '2026-10-10')

    const opportunity = writeVaultRecord(request('opportunity', 'OPP-700', opportunityPayload()), {
      vaultRoot: root,
    })
    assert.equal(opportunity.status, 'CREATED')
    const opportunityFm = frontmatterOf(path.join(root, opportunity.targetPath as string))
    assert.equal(opportunityFm.notes, opportunityPayload().notes)
    assert.equal(opportunityFm.source_url, undefined, 'no unsupported provenance field is invented')
  } finally {
    cleanup(root)
  }
})

/* 17 — no partial writes -------------------------------------------------- */

test('17. failed operations leave the vault byte-for-byte alone, one file at a time', () => {
  const root = makeVault()
  try {
    const before = walkMarkdown(root).sort()
    const snapshot = before.map((abs) => fs.readFileSync(abs, 'utf8'))

    const badRelationship = procurementMatchPayload()
    badRelationship.notice = '[[RFB-999 — Ghost Notice]]'
    writeVaultRecord(request('procurement_match', 'PMATCH-700', badRelationship), {
      vaultRoot: root,
    })

    const after = walkMarkdown(root).sort()
    assert.deepEqual(after, before, 'no files were added or removed')
    assert.deepEqual(
      after.map((abs) => fs.readFileSync(abs, 'utf8')),
      snapshot,
      'every existing file is unchanged',
    )
    assert.ok(!fs.existsSync(path.join(root, '12 - Procurement Matches')), 'no folder was created either')
  } finally {
    cleanup(root)
  }
})

/* dry-run ----------------------------------------------------------------- */

test('dry-run preview returns the exact payload and writes nothing', () => {
  const root = makeVault()
  try {
    const preview = previewVaultWrite(
      request('procurement_match', 'PMATCH-700', procurementMatchPayload()),
      { vaultRoot: root },
    )
    assert.equal(preview.status, 'READY')
    assert.equal(preview.targetPath, '12 - Procurement Matches/PMATCH-700.md')
    assert.ok(typeof preview.markdown === 'string' && preview.markdown.startsWith('---\n'))
    assert.equal(walkMarkdown(root).length, SEEDS.length, 'preview wrote nothing')
    assert.ok(!fs.existsSync(path.join(root, '12 - Procurement Matches')), 'preview created no folder')

    const written = writeVaultRecord(
      request('procurement_match', 'PMATCH-700', procurementMatchPayload()),
      { vaultRoot: root },
    )
    assert.equal(written.status, 'CREATED')
    assert.equal(
      fs.readFileSync(path.join(root, written.targetPath as string), 'utf8'),
      preview.markdown,
      'the written file equals the previewed payload',
    )
  } finally {
    cleanup(root)
  }
})

test('a rejected proposal previews as REJECTED with no Markdown', () => {
  const root = makeVault()
  try {
    const preview = previewVaultWrite(
      request('opportunity', 'OPP-700', opportunityPayload(), null),
      { vaultRoot: root },
    )
    assert.equal(preview.status, 'REJECTED')
    assert.equal(preview.markdown, null)
    assert.ok(preview.errors.some((e) => e.code === 'not_approved'))
    assert.equal(walkMarkdown(root).length, SEEDS.length)
  } finally {
    cleanup(root)
  }
})

/* 18 — no network --------------------------------------------------------- */

test('18. the writer contains no network access of any kind', () => {
  const source = fs.readFileSync(new URL('./writer.ts', import.meta.url), 'utf8')
  for (const token of [
    'fetch(',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'axios',
    'undici',
    'http.request',
    'createConnection',
  ]) {
    assert.ok(!source.includes(token), `writer.ts must not contain ${token}`)
  }
  assert.ok(!source.includes('Date.now'), 'the writer never reads a clock')
  assert.ok(!source.includes('Math.random'), 'the writer is deterministic')
})

test('the public surface is exactly one writer and one dry-run', () => {
  const exported = Object.keys(writerModule).sort()
  assert.deepEqual(exported, ['WRITABLE_RECORD_TYPES', 'previewVaultWrite', 'writeVaultRecord'])
  assert.deepEqual([...WRITABLE_RECORD_TYPES], [
    'opportunity',
    'notice',
    'match',
    'procurement_match',
    'bid',
  ])
})
