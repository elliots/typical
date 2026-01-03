import type { TypicalConfig } from '@elliots/typical'

export type FilterPattern = string | RegExp | (string | RegExp)[]

export interface Options {
  /**
   * Files to include. Defaults to all .ts/.tsx/.mts/.cts files.
   */
  include?: FilterPattern
  /**
   * Files to exclude. Defaults to node_modules.
   */
  exclude?: FilterPattern
  /**
   * Bun target environment.
   * @default 'bun'
   */
  target?: 'bun' | 'browser' | 'node'
  /**
   * Typical configuration overrides.
   */
  typical?: Partial<TypicalConfig>
}

export interface OptionsResolved {
  include: (string | RegExp)[]
  exclude: (string | RegExp)[]
  target: 'bun' | 'browser' | 'node'
  typical: Partial<TypicalConfig> | undefined
}

function normalizePattern(pattern: FilterPattern | undefined): (string | RegExp)[] {
  if (!pattern) return []
  if (Array.isArray(pattern)) return pattern
  return [pattern]
}

export function resolveOptions(options: Options): OptionsResolved {
  return {
    include: normalizePattern(options.include),
    exclude: options.exclude ? normalizePattern(options.exclude) : [/node_modules/],
    target: options.target ?? 'bun',
    typical: options.typical,
  }
}
