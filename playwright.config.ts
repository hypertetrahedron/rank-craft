import { defineConfig, devices } from '@playwright/test'

/**
 * The dev server is deliberately not reused from an existing process: these
 * tests exercise the Pyodide worker, which webpack bundles differently in dev
 * and production, and a stale server would silently test the wrong build.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // the Pyodide pool saturates the CPU on its own
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:3210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:debug',
    url: 'http://localhost:3210',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
