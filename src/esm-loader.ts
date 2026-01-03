import { fileURLToPath, pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { TypicalTransformer } from './transformer.js'
import { loadConfig, validateConfig } from './config.js'

const config = validateConfig(loadConfig())

// Shared transformer - stays alive for the lifetime of the process
let transformer: TypicalTransformer | null = null

async function getTransformer(): Promise<TypicalTransformer> {
  if (!transformer) {
    transformer = new TypicalTransformer(config)
  }
  return transformer
}

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
 * Note: Source maps not yet supported in v2
 */
export async function load(url: string, context: any, nextLoad: any) {
  if (!url.endsWith('.ts')) {
    return nextLoad(url, context)
  }
  const filePath = fileURLToPath(url)

  try {
    const t = await getTransformer()
    const result = await t.transform(filePath, 'ts')

    // For now, output is TypeScript - need to transpile to JS
    // TODO: Add JS transpilation in Go or here
    // For now, use TypeScript's transpileModule as fallback
    const ts = await import('typescript')
    const transpiled = ts.default.transpileModule(result.code, {
      compilerOptions: {
        module: ts.default.ModuleKind.ESNext,
        target: ts.default.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filePath,
    })

    return {
      format: 'module',
      source: transpiled.outputText,
      shortCircuit: true,
    }
  } catch (error) {
    console.error(`Error transforming ${filePath}:`, error)
    throw error
  }
}
