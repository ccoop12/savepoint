import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/main/services/**/*.ts'],
      exclude: ['src/main/services/database/migrations.ts']
    },
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
