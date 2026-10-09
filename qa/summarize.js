import * as fs from 'node:fs'
import * as path from 'node:path'

const writePath = process.argv.indexOf('--write') !== -1 ? process.argv[process.argv.indexOf('--write') + 1] : null

const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  let report
  try {
    report = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    console.error('JSON parse failed', e.message)
    process.exit(1)
  }
  const failures = []
  const walk = (suite, path) => {
    const here = path ? `${path} › ${suite.title}` : suite.title
    for (const s of suite.suites ?? []) walk(s, here)
    for (const t of suite.specs ?? []) {
      const title = `${here} › ${t.title}`
      for (const r of t.tests ?? []) {
        const status = r.results?.[r.results.length - 1]?.status
        const ok = r.status === 'expected' || status === 'passed'
        if (!ok) failures.push(title)
      }
    }
  }
  for (const suite of report.suites) walk(suite, '')
  console.log(`TOTAL tests: ${report.stats.expected} passed, ${report.stats.unexpected} failed, ${report.stats.skipped} skipped`)
  let sawTeeWarning = false
  for (const f of failures) {
    console.log('FAIL ' + f)
  }
  if (writePath) {
    fs.mkdirSync(path.dirname(writePath), { recursive: true })
    fs.writeFileSync(writePath, failures.join('\n') + '\n')
    console.log(`WROTE ${failures.length} failures to ${writePath}`)
  }
})