import { resolve, extname } from 'path'
import type { TypicalConfig, ProgramManager } from '@elliots/typical'
import { TypicalTransformer, validateConfig, buildTimer } from '@elliots/typical'

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/**
 * Result of transformTypia function - compatible with unplugin transform hook.
 */
export interface TransformTypiaResult {
  code: string
  map?: object | null
}

/**
 * Transform a TypeScript file with Typical.
 *
 * Uses a shared ProgramManager for incremental compilation across files.
 * Returns both code and source map for use with Vite/Rollup/Webpack.
 */
export function transformTypia(id: string, source: string, config: TypicalConfig, programManager: ProgramManager, options: { sourceMap?: boolean } = {}): TransformTypiaResult | undefined {
  buildTimer.start('total-transform')

  // Only transform TypeScript files (skip virtual modules, JS files, etc.)
  const ext = extname(id).toLowerCase()
  if (!TRANSFORM_EXTENSIONS.has(ext)) {
    buildTimer.end('total-transform')
    return undefined
  }

  const resolvedId = resolve(id)

  // Get or create program with this file's source
  buildTimer.start('get-program')
  const program = programManager.getProgram(resolvedId, source)
  buildTimer.end('get-program')

  // Get the source file from the program
  buildTimer.start('get-source-file')
  const sourceFile = programManager.getSourceFile(resolvedId)
  buildTimer.end('get-source-file')

  if (!sourceFile) {
    buildTimer.end('total-transform')
    console.warn(`[unplugin-typical] Could not get source file for: ${id}`)
    return undefined
  }

  // Validate config (adjusts reusableValidators if source maps are enabled)
  buildTimer.start('create-transformer')
  const validatedConfig = validateConfig(config)
  const transformer = new TypicalTransformer(validatedConfig, program)
  buildTimer.end('create-transformer')

  // Determine if source maps should be generated
  // Default to true for bundlers since they typically want source maps
  const generateSourceMap = options.sourceMap ?? config.sourceMap?.enabled ?? true

  // Transform the file with source map support
  buildTimer.start('transform')
  const result = transformer.transform(sourceFile, 'js', { sourceMap: generateSourceMap })
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
