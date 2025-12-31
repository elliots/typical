import ts from 'typescript'
import { resolve, dirname, extname } from 'path'
import type { TypicalConfig } from '@elliots/typical'
import { TypicalTransformer } from '@elliots/typical'

// Cache compiler options (these don't change)
let cachedCompilerOptions: ts.CompilerOptions | undefined

// Cache source files from disk (for imports, not the file being transformed)
const sourceFileCache = new Map<string, ts.SourceFile>()

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/**
 * Transform a TypeScript file with Typical.
 *
 * Creates a program per file that includes the provided source content.
 * This ensures the type checker can resolve types for the incoming code.
 */
export function transformTypia(
  id: string,
  source: string,
  config: TypicalConfig,
): string | undefined {
  // Only transform TypeScript files (skip virtual modules, JS files, etc.)
  const ext = extname(id).toLowerCase()
  if (!TRANSFORM_EXTENSIONS.has(ext)) {
    return undefined
  }

  const resolvedId = resolve(id)

  // Get compiler options (cached)
  const compilerOptions = getCompilerOptions()

  // Create a program with our source file
  const { program, sourceFile } = createProgramWithSource(resolvedId, source, compilerOptions)

  // Create transformer with this program
  const transformer = new TypicalTransformer(config, program)

  // Transform the file
  const result = transformer.transform(sourceFile, 'js')

  if (process.env.DEBUG) {
    console.log('[unplugin-typical] Transform output (first 1000 chars):', result.substring(0, 1000))
  }

  return result
}

/**
 * Get TypeScript compiler options from tsconfig.json (cached)
 */
function getCompilerOptions(): ts.CompilerOptions {
  if (cachedCompilerOptions) {
    return cachedCompilerOptions
  }

  const configPath = ts.findConfigFile(
    process.cwd(),
    ts.sys.fileExists,
    'tsconfig.json'
  )

  if (!configPath) {
    cachedCompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      strict: true,
    }
    return cachedCompilerOptions
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(configPath)
  )

  cachedCompilerOptions = parsed.options
  return cachedCompilerOptions
}

/**
 * Create a TypeScript program with the provided source content.
 * Uses a custom compiler host that:
 * - Returns the provided source for the target file
 * - Caches other source files from disk for reuse
 */
function createProgramWithSource(
  id: string,
  source: string,
  compilerOptions: ts.CompilerOptions,
): { program: ts.Program; sourceFile: ts.SourceFile } {
  // Create source file from the provided code
  const sourceFile = ts.createSourceFile(
    id,
    source,
    compilerOptions.target ?? ts.ScriptTarget.ES2020,
    true
  )

  // Create custom compiler host
  const host = ts.createCompilerHost(compilerOptions)
  const originalGetSourceFile = host.getSourceFile.bind(host)

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolvedFileName = resolve(fileName)

    // Return our source file for the target file
    if (resolvedFileName === id) {
      return sourceFile
    }

    // Check cache for other files
    const cached = sourceFileCache.get(resolvedFileName)
    if (cached) {
      return cached
    }

    // Read from disk and cache
    const result = originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    if (result) {
      sourceFileCache.set(resolvedFileName, result)
    }
    return result
  }

  // Create program with our file as entry
  const program = ts.createProgram([id], compilerOptions, host)

  // Debug: log source files in program
  if (process.env.DEBUG) {
    console.log('[unplugin-typical] Program source files:', program.getSourceFiles().map(sf => sf.fileName))
  }

  return { program, sourceFile: program.getSourceFile(id)! }
}
