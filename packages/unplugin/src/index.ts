import { createUnplugin, type UnpluginInstance } from 'unplugin'
import { loadConfig, type TypicalConfig, ProgramManager, buildTimer } from '@elliots/typical'
import { resolveOptions, type Options } from './core/options'
import { transformTypia } from './core/transform'

export const Typical: UnpluginInstance<Options | undefined, false> = createUnplugin((rawOptions = {}) => {
  const options = resolveOptions(rawOptions)

  const typicalConfig: TypicalConfig = {
    ...loadConfig(),
    ...options.typical,
  }

  // Shared program manager for incremental compilation
  const programManager = new ProgramManager()

  const name = 'unplugin-typical'
  return {
    name,
    enforce: options.enforce,

    buildStart() {
      buildTimer.reset()
      programManager.reset()
    },

    buildEnd() {
      if (process.env.DEBUG) {
        buildTimer.report()
      }
    },

    transform: {
      filter: {
        id: { include: options.include, exclude: options.exclude },
      },
      handler(code, id) {
        return transformTypia(id, code, typicalConfig, programManager)
      },
    },
  }
})

export type { Options }
