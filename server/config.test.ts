import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConfigError, readHostConfig } from './config'

test('applies safe defaults when the environment is empty', () => {
  const config = readHostConfig({}, process.cwd())
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 4174)
  assert.deepEqual(config.allowedOrigins, [])
  assert.equal(config.maxConcurrent, 4)
  assert.ok(config.maxBodyBytes > 0)
  assert.ok(config.requestTimeoutMs > 0)
})

test('parses valid overrides', () => {
  const config = readHostConfig(
    {
      TVB_HOST: 'localhost',
      TVB_PORT: '8080',
      TVB_ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443',
      TVB_MAX_CONCURRENT: '12',
      TVB_RATE_LIMIT_MAX: '5',
    },
    process.cwd(),
  )
  assert.equal(config.port, 8080)
  assert.deepEqual(config.allowedOrigins, ['https://a.example', 'https://b.example:8443'])
  assert.equal(config.maxConcurrent, 12)
  assert.equal(config.rateLimit.max, 5)
})

test('rejects an out-of-range or non-integer port instead of silently falling back', () => {
  assert.throws(() => readHostConfig({ TVB_PORT: '70000' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_PORT: 'abc' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_PORT: '4173.5' }, process.cwd()), ConfigError)
})

test('refuses a non-loopback bind unless the operator explicitly opts in', () => {
  assert.throws(() => readHostConfig({ TVB_HOST: '0.0.0.0' }, process.cwd()), ConfigError)
  const opted = readHostConfig({ TVB_HOST: '0.0.0.0', TVB_ALLOW_NON_LOOPBACK: '1' }, process.cwd())
  assert.equal(opted.host, '0.0.0.0')
})

test('rejects malformed allowed origins', () => {
  assert.throws(() => readHostConfig({ TVB_ALLOWED_ORIGINS: 'not a url' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_ALLOWED_ORIGINS: 'ftp://files.example' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_ALLOWED_ORIGINS: 'https://a.example/path' }, process.cwd()), ConfigError)
})

test('rejects unsafe or invalid numeric limits', () => {
  assert.throws(() => readHostConfig({ TVB_RATE_LIMIT_WINDOW_MS: '100' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_RATE_LIMIT_MAX: '0' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_MAX_BODY_BYTES: '99999999' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_REQUEST_TIMEOUT_MS: '10' }, process.cwd()), ConfigError)
  assert.throws(() => readHostConfig({ TVB_MAX_CONCURRENT: '0' }, process.cwd()), ConfigError)
})
