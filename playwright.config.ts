import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 5 browser QA config.
 *
 * Runs against a production build served by `vite preview`, so the tests
 * exercise the same bundle a reviewer would open. `npm run build` MUST be run
 * first: `reuseExistingServer: true` means Playwright skips the start command
 * when something already answers on the port, and this machine has no
 * `taskkill`/`netstat` available to clear a leftover server.
 *
 * The host is `localhost`, not `127.0.0.1`: vite preview resolves `localhost`
 * to ::1 on this machine, so an IPv4 health check would never connect.
 *
 * No external services are contacted. Every request in these tests goes to
 * localhost, and the vault is only ever read through the generated snapshot.
 */
export default defineConfig({
  testDir: './qa',
  outputDir: './qa/.artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: 'http://localhost:4187',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4187 --strictPort',
    url: 'http://localhost:4187',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Phase V: the vault bridge middleware reads TVB_VAULT_ROOT from the
    // preview server's own environment (never from the browser), and tests
    // target an ISOLATED directory — never the production vault. The path is
    // resolved from the repo root, where Playwright is always started.
    env: {
      ...process.env,
      TVB_VAULT_ROOT: path.resolve(process.cwd(), 'qa/.artifacts/vault-bridge-vault'),
    },
  },
})
