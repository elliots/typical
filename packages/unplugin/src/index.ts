import { createUnplugin, type UnpluginInstance } from 'unplugin'
import { TypicalTransformer, loadConfig, type TypicalConfig } from '@elliots/typical'
import { resolveOptions, type Options } from './core/options'

export const Typical: UnpluginInstance<Options | undefined, false> =
  createUnplugin((rawOptions = {}) => {
    const options = resolveOptions(rawOptions)

    const typicalConfig: TypicalConfig = {
      ...loadConfig(),
      ...options.typical,
    }

    const transformer = new TypicalTransformer(typicalConfig)

    const name = 'unplugin-typical'
    return {
      name,
      enforce: options.enforce,

      transform: {
        filter: {
          id: { include: options.include, exclude: options.exclude },
        },
        handler(code, id) {
          const sourceFile = transformer.createSourceFile(id, code)
          return transformer.transform(sourceFile, 'js')
        },
      },
    }
  })

export type { Options }
