import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Upgrade fixtures require a separate, explicitly authorised baseline run.
    include: ['test/unit/**/*.test.js', 'test/integration/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    // Integration tests share one scratch database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
