import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: './src/*.ts',
  inlineOnly: [],
  exports: true,
})
