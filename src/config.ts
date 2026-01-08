export interface TypicalDebugConfig {
  writeIntermediateFiles?: boolean
}

/**
 * Configuration options for source map generation.
 */
export interface TypicalSourceMapConfig {
  /**
   * Generate source maps. Default: true
   */
  enabled?: boolean
  /**
   * Include original source content in the map. Default: true
   */
  includeContent?: boolean
  /**
   * Use inline source maps (data URL) instead of external files. Default: false
   */
  inline?: boolean
}

export interface TypicalConfig {
  include?: string[]
  exclude?: string[]
  validateCasts?: boolean
  hoistRegex?: boolean
  debug?: TypicalDebugConfig
  /**
   * Type patterns to skip validation for (supports wildcards).
   * Use this for types that typia cannot process (e.g., React event types).
   * Example: ["React.*", "Express.Request", "*.Event"]
   */
  ignoreTypes?: string[]
  /**
   * Validate function parameters and return types at runtime.
   * When enabled, typed function parameters get runtime validation calls injected.
   * Default: true
   */
  validateFunctions?: boolean
  /**
   * Transform JSON.parse<T>() calls to validate and filter the parsed result
   * to only include properties defined in type T.
   * Default: true
   */
  transformJSONParse?: boolean
  /**
   * Transform JSON.stringify<T>() calls to only stringify properties defined
   * in type T, preventing accidental data leaks.
   * Default: true
   */
  transformJSONStringify?: boolean
  /**
   * Source map generation settings.
   * Controls whether and how source maps are generated for transformed code.
   */
  sourceMap?: TypicalSourceMapConfig
  /**
   * Maximum number of helper functions (_io0, _io1, etc.) that can be generated
   * for a single type before erroring. Complex DOM types or library types can
   * generate hundreds of functions which indicates a type that should be excluded.
   * Set to 0 to disable the limit.
   * Default: 50
   */
  maxGeneratedFunctions?: number
}

export const defaultConfig: TypicalConfig = {
  include: ['**/*.ts', '**/*.tsx'],
  exclude: ['node_modules/**', '**/*.d.ts', 'dist/**', 'build/**'],
  validateCasts: false,
  validateFunctions: true,
  transformJSONParse: true,
  transformJSONStringify: true,
  hoistRegex: true,
  debug: {
    writeIntermediateFiles: false,
  },
  sourceMap: {
    enabled: true,
    includeContent: true,
    inline: false,
  },
}

import fs from 'fs'
import path from 'path'

export function loadConfig(configPath?: string): TypicalConfig {
  const configFile = configPath || path.join(process.cwd(), 'typical.json')

  if (fs.existsSync(configFile)) {
    try {
      const configContent = fs.readFileSync(configFile, 'utf8')
      const userConfig: Partial<TypicalConfig> = JSON.parse(configContent)

      return {
        ...defaultConfig,
        ...userConfig,
      }
    } catch (error) {
      console.warn(`Failed to parse config file ${configFile}:`, error)
      return defaultConfig
    }
  }

  return defaultConfig
}

/**
 * Validate and adjust config for consistency.
 *
 * @param config The config to validate
 * @returns Validated/adjusted config
 */
export function validateConfig(config: TypicalConfig): TypicalConfig {
  // Reusable validators now throw at the call site, so they work correctly
  // with source maps. No need for special handling.
  return config
}
