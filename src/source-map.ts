import MagicString from 'magic-string'
import remapping from '@ampproject/remapping'
import type { DecodedSourceMap, EncodedSourceMap } from '@ampproject/remapping'

/**
 * Result of a transformation that includes source map information.
 */
export interface TransformResult {
  code: string
  map: EncodedSourceMap | null
}

/**
 * Configuration options for source map generation.
 */
export interface SourceMapOptions {
  /** Generate source maps. Default: true */
  enabled?: boolean
  /** Include source content in map. Default: true */
  includeContent?: boolean
  /** Use inline source maps (data URL). Default: false */
  inline?: boolean
}

/**
 * Default source map options.
 */
export const defaultSourceMapOptions: Required<SourceMapOptions> = {
  enabled: true,
  includeContent: true,
  inline: false,
}

/**
 * Compose multiple source maps together.
 * Given maps [A->B, B->C], produces A->C.
 * Maps are applied in order: first map is closest to original source.
 */
export function composeSourceMaps(maps: (EncodedSourceMap | DecodedSourceMap | string | null | undefined)[], _originalFileName: string): EncodedSourceMap | null {
  // Filter out null/undefined maps
  const validMaps = maps.filter((m): m is EncodedSourceMap | DecodedSourceMap | string => m !== null && m !== undefined)

  if (validMaps.length === 0) return null
  if (validMaps.length === 1) {
    const map = validMaps[0]
    if (typeof map === 'string') {
      return JSON.parse(map) as EncodedSourceMap
    }
    return map as EncodedSourceMap
  }

  // remapping expects maps in reverse order (final output first)
  // and a loader function that returns the source map for a given file
  const reversedMaps = [...validMaps].reverse()

  try {
    const result = remapping(reversedMaps, () => null)
    return result as EncodedSourceMap
  } catch (e) {
    // If remapping fails, return the last valid map
    console.warn('Source map composition failed:', e)
    const lastMap = validMaps[validMaps.length - 1]
    if (typeof lastMap === 'string') {
      return JSON.parse(lastMap) as EncodedSourceMap
    }
    return lastMap as EncodedSourceMap
  }
}

/**
 * Generate an inline source map comment (data URL).
 */
export function inlineSourceMapComment(map: EncodedSourceMap | string): string {
  const mapString = typeof map === 'string' ? map : JSON.stringify(map)
  const base64 = Buffer.from(mapString).toString('base64')
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`
}

/**
 * Generate an external source map URL comment.
 */
export function externalSourceMapComment(mapFileName: string): string {
  return `//# sourceMappingURL=${mapFileName}`
}

/**
 * Create a MagicString instance for tracking source modifications.
 */
export function createMagicString(source: string, filename?: string): MagicString {
  return new MagicString(source, {
    filename,
  })
}

/**
 * Generate a source map from a MagicString instance.
 */
export function generateSourceMap(
  ms: MagicString,
  options: {
    source: string
    file?: string
    includeContent?: boolean
    hires?: boolean | 'boundary'
  },
): EncodedSourceMap {
  return ms.generateMap({
    source: options.source,
    file: options.file ?? options.source,
    includeContent: options.includeContent ?? true,
    hires: options.hires ?? true,
  }) as EncodedSourceMap
}

/**
 * Create an identity source map (maps each position to itself).
 * Useful as a placeholder when no transformation occurred.
 */
export function createIdentityMap(source: string, fileName: string, includeContent: boolean = true): EncodedSourceMap {
  const ms = new MagicString(source)
  return ms.generateMap({
    source: fileName,
    file: fileName,
    includeContent,
    hires: true,
  }) as EncodedSourceMap
}

/**
 * Represents a tracked modification to source code.
 */
export interface SourceModification {
  /** Start position in original source */
  start: number
  /** End position in original source */
  end: number
  /** The replacement text */
  replacement: string
  /** Type of modification */
  type: 'insert-before' | 'insert-after' | 'replace' | 'prepend' | 'append'
}

/**
 * Apply a list of modifications to source code using MagicString.
 * Returns the modified code and source map.
 */
export function applyModifications(source: string, fileName: string, modifications: SourceModification[], includeContent: boolean = true): TransformResult {
  const ms = createMagicString(source, fileName)

  // Sort modifications by position (descending) to apply from end to start
  // This prevents position shifts from affecting subsequent modifications
  const sorted = [...modifications].sort((a, b) => b.start - a.start)

  for (const mod of sorted) {
    switch (mod.type) {
      case 'insert-before':
        ms.prependLeft(mod.start, mod.replacement)
        break
      case 'insert-after':
        ms.appendRight(mod.end, mod.replacement)
        break
      case 'replace':
        ms.overwrite(mod.start, mod.end, mod.replacement)
        break
      case 'prepend':
        ms.prepend(mod.replacement)
        break
      case 'append':
        ms.append(mod.replacement)
        break
    }
  }

  return {
    code: ms.toString(),
    map: generateSourceMap(ms, {
      source: fileName,
      includeContent,
    }),
  }
}

/**
 * Strip any existing source map comments from code.
 */
export function stripSourceMapComment(code: string): string {
  return code.replace(/\/\/[#@]\s*sourceMappingURL=.*/g, '')
}
