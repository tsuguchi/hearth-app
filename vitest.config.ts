import { defineConfig } from 'vitest/config'

// テストは Firebase Emulator を使う（npm test が Emulator を起動・終了する）
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
})
