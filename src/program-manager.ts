import ts from 'typescript'
import { resolve, dirname } from 'path'
import { buildTimer } from './timing.js'

/**
 * Manages a shared TypeScript program across file transformations.
 * This avoids the expensive cost of creating a new program for each file.
 */
export class ProgramManager {
  private program: ts.Program | undefined
  private compilerOptions: ts.CompilerOptions | undefined
  private sourceContents = new Map<string, string>() // Virtual file contents (transformed by bundler)
  private sourceFileCache = new Map<string, ts.SourceFile>() // Cached source files from disk
  private host: ts.CompilerHost | undefined

  /**
   * Get or create a program with the given source content for a file.
   * Uses incremental compilation to reuse data from previous program.
   */
  getProgram(id: string, source: string): ts.Program {
    const resolvedId = resolve(id)

    // Update virtual source content
    this.sourceContents.set(resolvedId, source)

    // Invalidate cached source file for this file (since content changed)
    this.sourceFileCache.delete(resolvedId)

    // Ensure we have compiler options and host
    if (!this.compilerOptions) {
      buildTimer.start('load-compiler-options')
      this.compilerOptions = this.loadCompilerOptions()
      buildTimer.end('load-compiler-options')
    }

    if (!this.host) {
      this.host = this.createHost()
    }

    // Get current root files, adding the new file if not present
    const rootFiles = this.program?.getRootFileNames() ?? []
    const rootFileSet = new Set(rootFiles)
    if (!rootFileSet.has(resolvedId)) {
      rootFileSet.add(resolvedId)
    }

    // Create program, reusing old program for incremental compilation
    buildTimer.start('create-program-incremental')
    this.program = ts.createProgram(
      Array.from(rootFileSet),
      this.compilerOptions,
      this.host,
      this.program, // KEY: pass old program for incremental reuse
    )
    buildTimer.end('create-program-incremental')

    return this.program
  }

  /**
   * Get the source file for a given ID from the current program.
   */
  getSourceFile(id: string): ts.SourceFile | undefined {
    const resolvedId = resolve(id)
    return this.program?.getSourceFile(resolvedId)
  }

  /**
   * Reset the program manager state (e.g., at build start).
   */
  reset(): void {
    this.program = undefined
    this.sourceContents.clear()
    // Keep sourceFileCache and compilerOptions since they don't change
  }

  private loadCompilerOptions(): ts.CompilerOptions {
    const configPath = ts.findConfigFile(process.cwd(), f => ts.sys.fileExists(f), 'tsconfig.json')

    if (!configPath) {
      return {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        esModuleInterop: true,
        strict: true,
      }
    }

    const configFile = ts.readConfigFile(configPath, f => ts.sys.readFile(f))
    if (configFile.error) {
      throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath))

    return parsed.options
  }

  private createHost(): ts.CompilerHost {
    const baseHost = ts.createCompilerHost(this.compilerOptions!)
    const originalGetSourceFile = baseHost.getSourceFile.bind(baseHost)

    return {
      ...baseHost,
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        const resolvedFileName = resolve(fileName)

        // Return virtual content if we have transformed source
        const virtualContent = this.sourceContents.get(resolvedFileName)
        if (virtualContent !== undefined) {
          // Check if we have a cached source file with the same content
          const cached = this.sourceFileCache.get(resolvedFileName)
          if (cached && cached.text === virtualContent) {
            return cached
          }

          // Create new source file from virtual content
          const sourceFile = ts.createSourceFile(resolvedFileName, virtualContent, languageVersion, true)
          this.sourceFileCache.set(resolvedFileName, sourceFile)
          return sourceFile
        }

        // Check cache for files loaded from disk
        const cachedDisk = this.sourceFileCache.get(resolvedFileName)
        if (cachedDisk) {
          return cachedDisk
        }

        // Load from disk and cache
        const result = originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        if (result) {
          this.sourceFileCache.set(resolvedFileName, result)
        }
        return result
      },
      fileExists: fileName => {
        const resolvedFileName = resolve(fileName)
        return this.sourceContents.has(resolvedFileName) || baseHost.fileExists(fileName)
      },
      readFile: fileName => {
        const resolvedFileName = resolve(fileName)
        return this.sourceContents.get(resolvedFileName) ?? baseHost.readFile(fileName)
      },
    }
  }
}
