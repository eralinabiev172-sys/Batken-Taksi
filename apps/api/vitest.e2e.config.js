import { defineConfig } from 'vitest/config'

// Run separately, from apps/api, ONLY against the disposable container busway-test-postgres-iso:
//   BUSWAY_E2E_ISO=1 npx vitest run --config vitest.e2e.config.js
// The suite verifies the container identity and published port before touching any data,
// and removes only the rows it created.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
