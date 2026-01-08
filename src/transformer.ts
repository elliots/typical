/**
 * TypicalTransformer - Thin wrapper around the Go compiler.
 *
 * The Go compiler (compiler) handles all TypeScript analysis
 * and validation code generation. This class just manages the lifecycle
 * and communication with the Go process.
 */

import { resolve } from 'path'
import { TypicalCompiler, type ProjectHandle, type RawSourceMap } from '@elliots/typical-compiler'
import type { TypicalConfig } from './config.js'
import { loadConfig } from './config.js'

export interface TransformResult {
  code: string
  map: RawSourceMap | null
}

export class TypicalTransformer {
  public config: TypicalConfig
  private compiler: TypicalCompiler
  private projectHandle: ProjectHandle | null = null
  private initPromise: Promise<void> | null = null
  private configFile: string

  constructor(config?: TypicalConfig, configFile: string = 'tsconfig.json') {
    this.config = config ?? loadConfig()
    this.configFile = configFile
    this.compiler = new TypicalCompiler({ cwd: process.cwd() })
  }

  /**
   * Ensure the Go compiler is started and project is loaded.
   * Uses lazy initialization - only starts on first transform.
   */
  private async ensureInitialized(x?: string): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.compiler.start()
        this.projectHandle = await this.compiler.loadProject(this.configFile)
      })()
    }
    await this.initPromise
  }

  /**
   * Transform a TypeScript file by adding runtime validation.
   *
   * @param fileName - Path to the TypeScript file
   * @param mode - Output mode: 'ts' returns TypeScript, 'js' would transpile (not yet supported)
   * @returns Transformed code with validation
   */
  async transform(fileName: string, mode: 'ts' | 'js' = 'ts'): Promise<TransformResult> {
    if (mode === 'js') {
      throw new Error('Mode "js" not yet supported - use "ts" and transpile separately')
    }

    await this.ensureInitialized()

    const resolvedPath = resolve(fileName)
    // Pass config options to the Go compiler
    const result = await this.compiler.transformFile(this.projectHandle!, resolvedPath, this.config.ignoreTypes, this.config.maxGeneratedFunctions)

    return {
      code: result.code,
      map: result.sourceMap ?? null,
    }
  }

  /**
   * Close the Go compiler process and release resources.
   * This immediately kills the process without waiting for pending operations.
   */
  async close(): Promise<void> {
    this.projectHandle = null
    this.initPromise = null
    await this.compiler.close()
  }
}
