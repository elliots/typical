import { createUnplugin, type UnpluginInstance } from 'unplugin'
import { loadConfig, type TypicalConfig } from '@elliots/typical'
import { resolveOptions, type Options } from './core/options'
import { transformTypia } from './core/transform'

export const Typical: UnpluginInstance<Options | undefined, false> =
  createUnplugin((rawOptions = {}) => {
    const options = resolveOptions(rawOptions)

    const typicalConfig: TypicalConfig = {
      ...loadConfig(),
      ...options.typical,
    }

    const name = 'unplugin-typical'
    return {
      name,
      enforce: options.enforce,

      transform: {
        filter: {
          id: { include: options.include, exclude: options.exclude },
        },
        handler(code, id) {
          return transformTypia(id, code, typicalConfig)
        },
      },
    }
  })

export type { Options }
