import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  inlineOnly: [],
  exports: true,
})
