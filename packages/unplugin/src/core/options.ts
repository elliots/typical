import type { FilterPattern } from 'unplugin'
import type { TypicalConfig } from '@elliots/typical'

export interface Options {
  include?: FilterPattern
  exclude?: FilterPattern
  enforce?: 'pre' | 'post' | undefined
  typical?: Partial<TypicalConfig>
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<Required<Options>, Pick<Options, 'enforce' | 'typical'>>

export function resolveOptions(options: Options): OptionsResolved {
  return {
    include: options.include || [/\.[cm]?[jt]sx?$/],
    exclude: options.exclude || [/node_modules/],
    enforce: 'enforce' in options ? options.enforce : 'pre',
    typical: options.typical,
  }
}
