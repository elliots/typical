import { fileURLToPath, pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { TypicalTransformer } from './transformer.js'
import { inlineSourceMapComment } from './source-map.js'
import { loadConfig, validateConfig } from './config.js'

const config = validateConfig(loadConfig())
const transformer = new TypicalTransformer(config)

/**
 * Resolve hook - rewrites .js imports to .ts if the .ts file exists
 */
export async function resolve(specifier: string, context: any, nextResolve: any) {
  // Only handle relative imports ending in .js
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    const { parentURL } = context
    if (parentURL) {
      const parentPath = fileURLToPath(parentURL)
      const dir = parentPath.substring(0, parentPath.lastIndexOf('/'))
      const tsPath = dir + '/' + specifier.slice(0, -3) + '.ts'

      if (existsSync(tsPath)) {
        return {
          url: pathToFileURL(tsPath).href,
          shortCircuit: true,
        }
      }
    }
  }

  return nextResolve(specifier, context)
}

/**
 * Load hook - transforms TypeScript files on the fly
 * Includes inline source maps for proper error stack traces in Node.js
 */
export async function load(url: string, context: any, nextLoad: any) {
  if (!url.endsWith('.ts')) {
    return nextLoad(url, context)
  }
  const filePath = fileURLToPath(url)

  try {
    // Transform with source map support enabled
    const result = transformer.transform(filePath, 'js', { sourceMap: true })

    // Append inline source map for Node.js source map support
    let source = result.code
    if (result.map) {
      source += '\n' + inlineSourceMapComment(result.map)
    }

    return {
      format: 'module',
      source,
      shortCircuit: true,
    }
  } catch (error) {
    console.error(`Error transforming ${filePath}:`, error)
    throw error
  }
}
