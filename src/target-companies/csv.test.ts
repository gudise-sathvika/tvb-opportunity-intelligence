import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTargetCompanyCsv } from './csv'

function csv(lines: string[]): string {
  return lines.join('\n')
}

test('valid CSV preview detects headers and rows', () => {
  const input = csv([
    'Company,Country,Stage',
    'Acme Inc,US,Growth',
    'Beta Ltd,UK,Startup',
    'Gamma GmbH,DE,Enterprise',
    'Delta SA,FR,SME',
    'Epsilon BV,NL,Growth',
  ])
  const result = parseTargetCompanyCsv(input)
  assert.deepEqual(result.headers, ['Company', 'Country', 'Stage'])
  assert.equal(result.rowCount, 5)
  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0][0], 'Acme Inc')
})

test('empty file produces an error', () => {
  const result = parseTargetCompanyCsv('')
  assert.equal(result.rowCount, 0)
  assert.ok(result.errors.some((e) => /empty/i.test(e)))
})

test('whitespace-only file produces an error', () => {
  const result = parseTargetCompanyCsv('   \n  ')
  assert.equal(result.rowCount, 0)
  assert.ok(result.errors.some((e) => /empty/i.test(e)))
})

test('malformed inconsistent rows are reported', () => {
  const input = csv([
    'A,B,C',
    '1,2,3',
    '4,5,6,7',
    '6,7,8',
    '9,10,11',
    '12,13,14',
  ])
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Malformed/i.test(e)))
  assert.ok(result.errors.some((e) => /row 3/i.test(e)))
})

test('duplicate exact rows are reported', () => {
  const input = csv([
    'Name,Country',
    'Acme,US',
    'Acme,US',
    'Beta,UK',
    'Gamma,DE',
    'Delta,FR',
  ])
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Duplicate record/i.test(e)))
})

test('duplicate identifier column values are reported', () => {
  const input = csv([
    'Company,Country',
    'Acme,US',
    'Beta,UK',
    'Acme,DE',
    'Delta,FR',
    'Epsilon,NL',
  ])
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Duplicate value "acme"/i.test(e)))
})

test('row count below 5 is reported', () => {
  const input = csv(['H1,H2', 'a,b', 'c,d', 'e,f'])
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Expected 5–10/i.test(e)))
})

test('row count above 10 is reported', () => {
  const lines = ['H1,H2']
  for (let i = 0; i < 11; i++) lines.push(`r${i},v${i}`)
  const result = parseTargetCompanyCsv(lines.join('\n'))
  assert.ok(result.errors.some((e) => /Expected 5–10/i.test(e)))
})

test('header-only file is reported', () => {
  const result = parseTargetCompanyCsv('A,B,C\n')
  assert.ok(result.errors.some((e) => /header row but no data rows/i.test(e)))
})

test('quoted fields with commas and newlines parse', () => {
  const input = 'Name,Notes\n"Acme, Inc.","line1\nline2"\nB,C\nD,E\nF,G\nH,I'
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rowCount, 5)
  assert.equal(result.rows[0][0], 'Acme, Inc.')
  assert.equal(result.rows[0][1], 'line1\nline2')
})

test('BOM is stripped from the first header', () => {
  const input = '\uFEFFName,Value\nA,1\nB,2\nC,3\nD,4\nE,5'
  const result = parseTargetCompanyCsv(input)
  assert.deepEqual(result.headers, ['Name', 'Value'])
  assert.equal(result.errors.length, 0)
})

test('escaped quotes are preserved', () => {
  const input = 'Name,Note\nA,"He said ""hi"""\nB,2\nC,3\nD,4\nE,5'
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rows[0][1], 'He said "hi"')
})

test('three rows sharing Austin, US do not produce an identity duplicate warning', () => {
  const input = [
    'company name,company HQ location',
    'ContextQA,"Austin, US"',
    'flareAI,"Austin, US"',
    'Mask NextGen,"Austin, US"',
    'Beta,UK',
    'Gamma,DE',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.ok(!result.errors.some((e) => /identity field/i.test(e)))
})

test('genuine repeated company names produce a review warning', () => {
  const input = [
    'company name,company URL',
    'Acme,https://a.example',
    'Acme,https://b.example',
    'Beta,https://c.example',
    'Gamma,https://d.example',
    'Delta,https://e.example',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Possible duplicate value "acme"/i.test(e)))
  assert.ok(result.errors.some((e) => /not proof/i.test(e)))
})

test('duplicate company names are warnings, not merges', () => {
  const input = [
    'company name,company HQ location',
    'Acme,US',
    'Acme,US',
    'Beta,UK',
    'Gamma,DE',
    'Delta,FR',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rowCount, 5)
  assert.ok(result.errors.some((e) => /Possible duplicate value "acme"/i.test(e)))
})

test('blank and duplicate headers are reported', () => {
  const input = [
    'Name,,Name',
    'A,1,2',
    'B,3,4',
    'C,5,6',
    'D,7,8',
    'E,9,10',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.ok(result.errors.some((e) => /Blank header/i.test(e)))
  assert.ok(result.errors.some((e) => /Duplicate header "Name"/i.test(e)))
})

test('malformed rows are retained with original values', () => {
  const input = [
    'A,B,C',
    '1,2,3',
    '4,5,6,7',
    '6,7,8,9',
    '10,11,12',
    '13,14,15',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rowCount, 5)
  assert.deepEqual(result.rows[1], ['4', '5', '6', '7'])
  assert.deepEqual(result.rows[2], ['6', '7', '8', '9'])
  assert.ok(result.errors.some((e) => /Malformed/i.test(e)))
})

test('missing and extra cells are reported as malformed, not discarded', () => {
  const input = [
    'H1,H2,H3',
    'a,b,c,d',
    'c,d,e,f',
    'g,h,i',
    'j,k,l',
    'm,n,o',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rows[0].length, 4)
  assert.equal(result.rows[1].length, 4)
  assert.ok(result.errors.some((e) => /row 2 has 4 columns/i.test(e)))
  assert.ok(result.errors.some((e) => /row 3 has 4 columns/i.test(e)))
})

test('actual pilot CSV retains all five records; ICP is optional', () => {
  const input = [
    '\uFEFFcompany name,company URL,company HQ location,company sector,Ideal Customer Profile',
    'ContextQA,https://contextai.us/,"Austin, US",AI Infrastructure,',
    'flareAI,https://flareai.co/,"Austin, US","product, lead generation",',
    'Growth Channel,,,,',
    'Mask NextGen,https://www.masknextgen.com/,"Austin, US","product, EdTec, Cyber Security,  Al",',
    'Pacewisdom,http://www.pacewisdom.com/,"Bangalore, India","Software Services, AI",',
  ].join('\n')
  const result = parseTargetCompanyCsv(input)
  assert.equal(result.rowCount, 5)
  assert.equal(result.rows[0][3], 'AI Infrastructure')
  assert.equal(result.rows[3][3], 'product, EdTec, Cyber Security,  Al')
  assert.ok(!result.errors.some((e) => /identity field/i.test(e)))
  // ICP is optional and, in this pilot file, all supplied ICP values are empty.
  assert.ok(result.rows.every((row) => (row[4] ?? '').trim() === ''))
  // Growth Channel has missing URL, HQ, and sector; ICP is also empty but not required.
  assert.deepEqual(result.rows[2], ['Growth Channel', '', '', '', ''])
})