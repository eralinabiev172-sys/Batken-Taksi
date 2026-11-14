import { defineConfig, devices } from '@playwright/test'

// Real-API browser check (opt-in): passenger page -> real Fastify -> disposable PostgreSQL -> WebSocket.
// Needs the isolated container busway-test-postgres-iso to be running. Run from apps/web:
//   npx playwright test -c playwright.real.config.js
export default defineConfig({
  testDir: './e2e-real',
  workers: 1,
  fullyParallel: false,
  webServer: [
    {
      command: 'node ../api/scripts/iso-test-server.mjs',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_USE_REAL_API: 'true' },
    },
  ],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'on-first-retry' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
})
