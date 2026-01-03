import typicalPlugin, { closeTransformer } from '@elliots/bun-plugin-typical'

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  sourcemap: 'inline', // Tell Bun to include source maps
  plugins: [
    typicalPlugin({
      typical: {
        reusableValidators: true,
        sourceMap: {
          enabled: true,
          includeContent: true,
          inline: true,
        },
      },
    }),
  ],
})

// Close the transformer to release the Go process
await closeTransformer()

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build succeeded!')
console.log(
  'Output files:',
  result.outputs.map(o => o.path),
)
