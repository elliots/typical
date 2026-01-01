import { resolve, extname } from 'path'
import type { TypicalConfig } from '@elliots/typical'
import { TypicalTransformer } from '@elliots/typical'
import { buildTimer } from './timing'
import type { ProgramManager } from './program-manager'

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/**
 * Transform a TypeScript file with Typical.
 *
 * Uses a shared ProgramManager for incremental compilation across files.
 */
export function transformTypia(
  id: string,
  source: string,
  config: TypicalConfig,
  programManager: ProgramManager,
): string | undefined {
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

  // Create transformer with this program
  buildTimer.start('create-transformer')
  const transformer = new TypicalTransformer(config, program)
  buildTimer.end('create-transformer')

  // Transform the file
  buildTimer.start('transform')
  const result = transformer.transform(sourceFile, 'js')
  buildTimer.end('transform')

  buildTimer.end('total-transform')

  if (process.env.DEBUG) {
    console.log('[unplugin-typical] Transform output (first 1000 chars):', result.substring(0, 1000))
  }

  return result
}
