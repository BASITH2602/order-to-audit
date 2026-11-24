import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    fileParallelism: false, // the benchmark test shares one database
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
