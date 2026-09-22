import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000, // concurrency tests fire many real requests; the default 5s is too tight
    hookTimeout: 30000,
    // These are integration tests against a real (shared, connection-limited)
    // database — see tests/setup.ts. Running test files in parallel workers
    // would multiply connection pressure on top of what each file's own
    // concurrency tests already generate, and isn't needed for correctness
    // (every test asserts against rows it created itself, identified by ID,
    // never "the next number in sequence" — so true cross-file parallelism
    // would be safe, it's just not worth the added DB load here).
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
  },
})
