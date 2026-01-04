import { resolve, extname } from 'path'
import type { TypicalConfig } from '@elliots/typical'
import type { RawSourceMap } from '@elliots/typical-compiler'
import { TypicalTransformer, buildTimer } from '@elliots/typical'

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

// Errors that indicate a file should be skipped (not transformed)
const SKIP_ERROR_PATTERNS = [
  'source file not found', // File is outside the TypeScript project
]

/**
 * Result of transformTypia function - compatible with unplugin transform hook.
 */
export interface TransformTypiaResult {
  code: string
  map: RawSourceMap | null
}

// Shared transformer instance - Go server stays running across transforms
let transformer: TypicalTransformer | null = null

/**
 * Transform a TypeScript file with Typical.
 *
 * Uses the Go compiler via TypicalCompiler for validation code generation.
 * The Go server stays running and maintains the TypeScript program state.
 */
export async function transformTypia(
  id: string,
  _source: string, // unused - Go reads file directly
  config: TypicalConfig,
): Promise<TransformTypiaResult | undefined> {
  buildTimer.start('total-transform')

  // Only transform TypeScript files (skip virtual modules, JS files, etc.)
  const ext = extname(id).toLowerCase()
  if (!TRANSFORM_EXTENSIONS.has(ext)) {
    buildTimer.end('total-transform')
    return undefined
  }

  const resolvedId = resolve(id)

  // Lazy init shared transformer
  if (!transformer) {
    buildTimer.start('init-transformer')
    transformer = new TypicalTransformer(config)
    buildTimer.end('init-transformer')
  }

  // Transform the file
  buildTimer.start('transform')
  let result
  try {
    result = await transformer.transform(resolvedId, 'ts')
  } catch (error) {
    buildTimer.end('transform')
    buildTimer.end('total-transform')

    // Check if this is an error we should skip (e.g., file outside project)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const shouldSkip = SKIP_ERROR_PATTERNS.some(pattern => errorMessage.includes(pattern))

    if (shouldSkip) {
      if (process.env.DEBUG) {
        console.log(`[unplugin-typical] Skipping file (not in project): ${resolvedId}`)
      }
      return undefined
    }

    // Re-throw other errors
    throw error
  }
  buildTimer.end('transform')

  buildTimer.end('total-transform')

  if (process.env.DEBUG) {
    console.log('[unplugin-typical] Transform output (first 1000 chars):', result.code.substring(0, 1000))
  }

  return {
    code: result.code,
    map: result.map,
  }
}

/**
 * Close the transformer and release resources.
 * Should be called at build end.
 */
export async function closeTransformer(): Promise<void> {
  if (transformer) {
    await transformer.close()
    transformer = null
  }
}
