import { resolve, extname } from 'path'
import type { TypicalConfig } from '@elliots/typical'
import { TypicalTransformer, validateConfig, buildTimer, inlineSourceMapComment } from '@elliots/typical'

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

// Map file extensions to Bun loader types
const LOADER_MAP: Record<string, 'js' | 'jsx'> = {
  '.ts': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.tsx': 'jsx',
}

export interface TransformResult {
  code: string
  loader: 'js' | 'jsx'
}

/**
 * Transform a TypeScript file with Typical.
 *
 * Returns JavaScript code with validation injected.
 */
export function transformFile(filePath: string, config: TypicalConfig): TransformResult | undefined {
  buildTimer.start('total-transform')

  // Only transform TypeScript files
  const ext = extname(filePath).toLowerCase()
  if (!TRANSFORM_EXTENSIONS.has(ext)) {
    buildTimer.end('total-transform')
    return undefined
  }

  const resolvedPath = resolve(filePath)

  // Validate config and create transformer
  // NOTE: We don't pass a program - let TypicalTransformer use setupTsProgram
  // to get proper project-wide type information
  buildTimer.start('create-transformer')
  const validatedConfig = validateConfig(config)
  const transformer = new TypicalTransformer(validatedConfig)
  buildTimer.end('create-transformer')

  // Determine if source maps should be generated
  const generateSourceMap = validatedConfig.sourceMap?.enabled ?? false

  // Transform the file - use 'js' mode to fully resolve Typia calls into validation code
  // Pass the file path as a string, transformer will read and parse it
  buildTimer.start('transform')
  const result = transformer.transform(resolvedPath, 'js', { sourceMap: generateSourceMap })
  buildTimer.end('transform')

  buildTimer.end('total-transform')

  if (process.env.DEBUG) {
    console.log(`[bun-plugin-typical] Transformed: ${filePath}`)
  }

  // Inline source map if generated
  let code = result.code
  if (result.map) {
    code += '\n' + inlineSourceMapComment(result.map)
  }

  return {
    code,
    loader: LOADER_MAP[ext] ?? 'js',
  }
}
