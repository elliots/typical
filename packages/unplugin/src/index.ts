import { createUnplugin, type UnpluginInstance } from 'unplugin'
import { loadConfig, type TypicalConfig, buildTimer } from '@elliots/typical'
import { resolveOptions, type Options } from './core/options'
import { transformTypia, closeTransformer } from './core/transform'

export const Typical: UnpluginInstance<Options | undefined, false> = createUnplugin((rawOptions = {}) => {
  const options = resolveOptions(rawOptions)

  const typicalConfig: TypicalConfig = {
    ...loadConfig(),
    ...options.typical,
  }

  const name = 'unplugin-typical'
  return {
    name,
    enforce: options.enforce,

    buildStart() {
      buildTimer.reset()
    },

    async buildEnd() {
      if (process.env.DEBUG) {
        buildTimer.report()
      }
      // Close the Go compiler when build ends
      await closeTransformer()
    },

    transform: {
      filter: {
        id: { include: options.include, exclude: options.exclude },
      },
      async handler(code, id) {
        const result = await transformTypia(id, code, typicalConfig)
        if (process.env.DEBUG && result) {
          console.log(`[unplugin-typical] Transformed ${id}:`)
          console.log(`  - Input length: ${code.length}`)
          console.log(`  - Output length: ${result.code.length}`)
          console.log(`  - Changed: ${code !== result.code}`)
        }
        return result
      },
    },
  }
})

export type { Options }

// Export bundler-specific plugins
export default Typical
