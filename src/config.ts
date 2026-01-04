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
  reusableValidators?: boolean
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
   * Skip validation for DOM types (Document, Element, Node, etc.) and their subclasses.
   * These types have complex Window intersections that typia cannot process.
   * Default: true
   */
  ignoreDOMTypes?: boolean
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
}

/**
 * Pre-compiled regex patterns for ignore type matching.
 * This is populated during config loading for performance.
 */
export interface CompiledIgnorePatterns {
  /** Compiled patterns from user ignoreTypes config */
  userPatterns: RegExp[]
  /** Compiled patterns from DOM_TYPES_TO_IGNORE (when ignoreDOMTypes is true) */
  domPatterns: RegExp[]
  /** All patterns combined for quick checking */
  allPatterns: RegExp[]
}

export const defaultConfig: TypicalConfig = {
  include: ['**/*.ts', '**/*.tsx'],
  exclude: ['node_modules/**', '**/*.d.ts', 'dist/**', 'build/**'],
  reusableValidators: false, // Off by default for accurate source maps (set to true for production)
  validateCasts: false,
  validateFunctions: true,
  transformJSONParse: true,
  transformJSONStringify: true,
  hoistRegex: true,
  ignoreDOMTypes: true,
  debug: {
    writeIntermediateFiles: false,
  },
  sourceMap: {
    enabled: true, // On by default for debugging (set to false for production)
    includeContent: true,
    inline: false,
  },
}

// FIXME: find a better way to work out which types to ignore
/**
 * DOM types that typia cannot process due to Window global intersections.
 * These are the base DOM types - classes extending them are checked separately.
 */
export const DOM_TYPES_TO_IGNORE = [
  // Core DOM types
  'Document',
  'DocumentFragment',
  'Element',
  'Node',
  'ShadowRoot',
  'Window',
  'EventTarget',
  // HTML Elements
  'HTML*Element',
  'HTMLElement',
  'HTMLCollection',
  // SVG Elements
  'SVG*Element',
  'SVGElement',
  // Events
  '*Event',
  // Other common DOM types
  'NodeList',
  'DOMTokenList',
  'NamedNodeMap',
  'CSSStyleDeclaration',
  'Selection',
  'Range',
  'Text',
  'Comment',
  'CDATASection',
  'ProcessingInstruction',
  'DocumentType',
  'Attr',
  'Table',
  'TableRow',
  'TableCell',
  'StyleSheet',
]

import fs from 'fs'
import path from 'path'

/**
 * Convert a glob pattern to a RegExp for type matching.
 * Supports wildcards: "React.*" -> /^React\..*$/
 */
export function compileIgnorePattern(pattern: string): RegExp | null {
  try {
    const regexStr =
      '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
        .replace(/\*/g, '.*') +
      '$'
    return new RegExp(regexStr)
  } catch (error) {
    console.warn(`TYPICAL: Invalid ignoreTypes pattern "${pattern}": ${(error as Error).message}`)
    return null
  }
}

/**
 * Pre-compile all ignore patterns for efficient matching.
 */
export function compileIgnorePatterns(config: TypicalConfig): CompiledIgnorePatterns {
  const userPatterns: RegExp[] = []
  const domPatterns: RegExp[] = []

  // Compile user patterns
  for (const pattern of config.ignoreTypes ?? []) {
    const compiled = compileIgnorePattern(pattern)
    if (compiled) {
      userPatterns.push(compiled)
    }
  }

  // Compile DOM patterns if enabled (default: true)
  if (config.ignoreDOMTypes !== false) {
    for (const pattern of DOM_TYPES_TO_IGNORE) {
      const compiled = compileIgnorePattern(pattern)
      if (compiled) {
        domPatterns.push(compiled)
      }
    }
  }

  return {
    userPatterns,
    domPatterns,
    allPatterns: [...userPatterns, ...domPatterns],
  }
}

// Cache for compiled patterns, keyed by config identity
let cachedPatterns: CompiledIgnorePatterns | null = null
let cachedConfig: TypicalConfig | null = null

/**
 * Get compiled ignore patterns, using cache if config hasn't changed.
 */
export function getCompiledIgnorePatterns(config: TypicalConfig): CompiledIgnorePatterns {
  // Simple identity check - if same config object, use cache
  if (cachedConfig === config && cachedPatterns) {
    return cachedPatterns
  }

  cachedConfig = config
  cachedPatterns = compileIgnorePatterns(config)
  return cachedPatterns
}

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

let warnedAboutSourceMaps = false

/**
 * Validate and adjust config for consistency.
 * Currently handles:
 * - Disabling reusableValidators when source maps are enabled (required for accurate mappings)
 *
 * @param config The config to validate
 * @returns Validated/adjusted config
 */
export function validateConfig(config: TypicalConfig): TypicalConfig {
  let result = config

  // Source maps require inline validators (not reusable) because each validation
  // call needs its own source map marker pointing to the correct type annotation.
  // With reusable validators, the expanded typia code would all map to the validator
  // declaration rather than the individual usage sites.
  const sourceMapEnabled = config.sourceMap?.enabled !== false
  const reusableValidatorsEnabled = config.reusableValidators === true

  if (sourceMapEnabled && reusableValidatorsEnabled) {
    if (!warnedAboutSourceMaps) {
      warnedAboutSourceMaps = true
      console.warn(
        'TYPICAL: Both sourceMap and reusableValidators are enabled. ' + 'Disabling reusableValidators for accurate source mapping. ' + 'For production builds, set sourceMap.enabled: false to use reusableValidators.',
      )
    }
    result = { ...result, reusableValidators: false }
  }

  return result
}
