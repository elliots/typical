import type ts from 'typescript'
import type { PluginConfig, ProgramTransformerExtras } from 'ts-patch'
import { TypicalCompiler } from '@elliots/typical-compiler'
import { loadConfig, validateConfig, type TypicalConfig } from '@elliots/typical'
import deasync from 'deasync'

/**
 * Synchronous wrapper around the async compiler transformFile.
 */
function transformFileSync(compiler: TypicalCompiler, project: string, fileName: string, config: TypicalConfig): string {
  let result: string | undefined
  let error: Error | undefined
  let done = false

  compiler.transformFile(project, fileName, config.ignoreTypes, config.maxGeneratedFunctions, config.reusableValidators).then(
    res => {
      result = res.code
      done = true
    },
    err => {
      error = err
      done = true
    },
  )

  deasync.loopWhile(() => !done)

  if (error) throw error
  return result!
}

/**
 * TSC Program Transformer Plugin for typical.
 *
 * Uses transformProgram to intercept program creation and transform source files
 * before TypeScript processes them. This allows us to inject validators into
 * the source code while maintaining proper TypeScript semantics.
 *
 * Configure in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "plugins": [
 *       { "transform": "@elliots/typical-tsc-plugin", "transformProgram": true }
 *     ]
 *   }
 * }
 */
export default function (program: ts.Program, host: ts.CompilerHost | undefined, _pluginConfig: PluginConfig, { ts: tsInstance }: ProgramTransformerExtras): ts.Program {
  const config = validateConfig(loadConfig())
  void config // unused for now, but available for future config options

  // Initialize compiler synchronously
  const compiler = new TypicalCompiler({ cwd: process.cwd() })
  let projectHandle: string | undefined
  let initError: Error | undefined
  let initDone = false

  compiler
    .start()
    .then(() => compiler.loadProject('tsconfig.json'))
    .then(handle => {
      projectHandle = handle.id
      initDone = true
    })
    .catch(err => {
      initError = err
      initDone = true
    })

  deasync.loopWhile(() => !initDone)
  if (initError) throw initError

  const compilerOptions = program.getCompilerOptions()
  const originalHost = host ?? tsInstance.createCompilerHost(compilerOptions)

  // Create a custom host that returns transformed source files
  const transformedFiles = new Map<string, string>()

  // Transform all source files
  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files and node_modules
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) {
      continue
    }

    try {
      const transformed = transformFileSync(compiler, projectHandle!, sourceFile.fileName, config)
      transformedFiles.set(sourceFile.fileName, transformed)
    } catch (err) {
      console.error(`[typical] Failed to transform ${sourceFile.fileName}:`, err)
    }
  }

  // Create a new host that provides transformed source text
  const newHost: ts.CompilerHost = {
    ...originalHost,
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const transformed = transformedFiles.get(fileName)
      if (transformed) {
        return tsInstance.createSourceFile(fileName, transformed, typeof languageVersionOrOptions === 'object' ? languageVersionOrOptions : { languageVersion: languageVersionOrOptions })
      }
      return originalHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
    },
  }

  // Create a new program with the transformed source files
  const rootNames = program.getRootFileNames()
  return tsInstance.createProgram(rootNames, compilerOptions, newHost, program)
}
