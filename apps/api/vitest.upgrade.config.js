import { defineConfig } from 'vitest/config'

// Run separately, from apps/api, only after authorising the disposable test DB:
// vitest run --config vitest.upgrade.config.js
// The suite refuses any state other than the verified 0001 baseline. No reset.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/migration-upgrade/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
