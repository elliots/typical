import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/vite.ts',
    'src/rollup.ts',
    'src/esbuild.ts',
    'src/webpack.ts',
    'src/rolldown.ts',
    'src/rspack.ts',
    'src/farm.ts',
  ],
  format: 'esm',
  dts: true,
  clean: true,
  tsconfig: '../../tsconfig.json',
})
