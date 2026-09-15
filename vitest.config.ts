import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The emulator and rules-unit-testing share one project's state, so files
    // run one at a time — parallel files would clear each other's seed data.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
