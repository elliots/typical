import { spawn, ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { encodeRequest, decodeResponse, MessageType } from './protocol.js'
import type { ProjectHandle, TransformResult, AnalyseResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const debug = process.env.DEBUG === '1'

function debugLog(...args: unknown[]): void {
  if (debug) {
    console.error(...args)
  }
}

function getBinaryPath(): string {
  // try local binary first (for development)
  const localBinPath = join(__dirname, '..', 'bin', 'typical')
  try {
    require('fs').accessSync(localBinPath)
    debugLog(`[CLIENT] Using local binary at ${localBinPath}`)
    return localBinPath
  } catch {
    // continue to platform-specific package
  }

  // Then use platform-specific package
  const platform = process.platform // darwin, linux, win32
  const arch = process.arch // arm64, x64
  const pkgName = `@elliots/typical-compiler-${platform}-${arch}`

  const pkg = require(pkgName) as { binaryPath: string }
  debugLog(`[CLIENT] Using platform binary from ${pkgName}`)
  return pkg.binaryPath
}

export interface TypicalCompilerOptions {
  /** Path to the typical binary. If not provided, uses the bundled binary. */
  binaryPath?: string
  /** Current working directory for the compiler. */
  cwd?: string
}

export class TypicalCompiler {
  private process: ChildProcess | null = null
  private pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map()
  private buffer: Buffer = Buffer.alloc(0)
  private binaryPath: string
  private cwd: string
  private nextRequestId = 0

  constructor(options: TypicalCompilerOptions = {}) {
    this.binaryPath = options.binaryPath ?? getBinaryPath()
    this.cwd = options.cwd ?? process.cwd()
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Compiler already started')
    }

    this.process = spawn(this.binaryPath, ['--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    // Don't let the child process keep the Node process alive
    this.process.unref()

    this.process.stdout!.on('data', (data: Buffer) => {
      this.handleData(data)
    })

    this.process.on('error', err => {
      console.error('Compiler process error:', err)
    })

    this.process.on('exit', code => {
      this.process = null
      // Reject any pending requests
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error(`Compiler process exited with code ${code}`))
      }
      this.pendingRequests.clear()
    })

    // Test the connection with echo
    const result = await this.request<string>('echo', 'ping')
    if (result !== 'ping') {
      throw new Error(`Echo test failed: expected "ping", got "${result}"`)
    }
  }

  async close(): Promise<void> {
    if (this.process) {
      const proc = this.process
      this.process = null
      // Clear pending requests to avoid errors after close
      this.pendingRequests.clear()
      proc.stdin?.end()
      proc.kill()
    }
  }

  async loadProject(configFileName: string): Promise<ProjectHandle> {
    return this.request<ProjectHandle>('loadProject', { configFileName })
  }

  async transformFile(project: ProjectHandle | string, fileName: string, ignoreTypes?: string[], maxGeneratedFunctions?: number, reusableValidators?: 'auto' | 'never' | 'always'): Promise<TransformResult> {
    const projectId = typeof project === 'string' ? project : project.id
    return this.request<TransformResult>('transformFile', {
      project: projectId,
      fileName,
      ignoreTypes,
      maxGeneratedFunctions,
      reusableValidators,
    })
  }

  async release(handle: ProjectHandle | string): Promise<void> {
    const id = typeof handle === 'string' ? handle : handle.id
    await this.request<null>('release', id)
  }

  /**
   * Analyse a file for validation points without transforming it.
   * Returns information about which parameters, returns, and casts will be validated.
   * Used by the VSCode extension to show validation indicators.
   *
   * @param project - Project handle or ID
   * @param fileName - Path to the file to analyse
   * @param content - Optional file content for live updates (uses disk version if not provided)
   * @param ignoreTypes - Optional glob patterns for types to skip
   * @returns Analysis result with validation items
   */
  async analyseFile(
    project: ProjectHandle | string,
    fileName: string,
    content?: string,
    ignoreTypes?: string[],
  ): Promise<AnalyseResult> {
    const projectId = typeof project === 'string' ? project : project.id
    return this.request<AnalyseResult>('analyseFile', {
      project: projectId,
      fileName,
      content,
      ignoreTypes,
    })
  }

  /**
   * Transform a standalone TypeScript source string.
   * Creates a temporary project to enable type checking.
   *
   * @param fileName - Virtual filename for error messages (e.g., "test.ts")
   * @param source - TypeScript source code
   * @param options - Optional transform options
   * @returns Transformed code with validation
   */
  async transformSource(
    fileName: string,
    source: string,
    options?: {
      ignoreTypes?: string[]
      maxGeneratedFunctions?: number
      reusableValidators?: 'auto' | 'never' | 'always'
    },
  ): Promise<TransformResult> {
    return this.request<TransformResult>('transformSource', {
      fileName,
      source,
      ignoreTypes: options?.ignoreTypes,
      maxGeneratedFunctions: options?.maxGeneratedFunctions,
      reusableValidators: options?.reusableValidators,
    })
  }

  private async request<T>(method: string, payload: unknown): Promise<T> {
    if (!this.process) {
      throw new Error('Compiler not started')
    }

    // Use unique request ID to correlate request/response
    const requestId = `${method}:${this.nextRequestId++}`
    const requestData = encodeRequest(requestId, payload)

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      this.process!.stdin!.write(requestData)
    })
  }

  private handleData(data: Buffer): void {
    // Append new data to buffer
    this.buffer = Buffer.concat([this.buffer, data])
    debugLog(`[CLIENT DEBUG] handleData: received ${data.length} bytes, buffer now ${this.buffer.length} bytes`)

    // Try to decode messages
    while (this.buffer.length > 0) {
      try {
        debugLog(`[CLIENT DEBUG] Attempting to decode ${this.buffer.length} bytes...`)
        const { messageType, method, payload, bytesConsumed } = decodeResponse(this.buffer)
        debugLog(`[CLIENT DEBUG] Decoded: type=${messageType} method=${method} payload=${payload.length} bytes, consumed=${bytesConsumed}`)

        // Find the pending request
        const pending = this.pendingRequests.get(method)
        if (!pending) {
          const pendingKeys = [...this.pendingRequests.keys()].join(', ') || '(none)'
          throw new Error(`No pending request for method: ${method}. Pending requests: ${pendingKeys}. ` + `This indicates a protocol bug - received response for a request that wasn't made or was already resolved.`)
        }

        this.pendingRequests.delete(method)

        if (messageType === MessageType.Response) {
          // Parse JSON payload
          const result = payload.length > 0 ? JSON.parse(payload.toString('utf8')) : null
          pending.resolve(result)
        } else if (messageType === MessageType.Error) {
          pending.reject(new Error(payload.toString('utf8')))
        } else {
          pending.reject(new Error(`Unexpected message type: ${messageType}`))
        }

        // Remove only the processed bytes from buffer
        this.buffer = this.buffer.subarray(bytesConsumed)
      } catch (e) {
        // Not enough data yet, wait for more
        debugLog(`[CLIENT DEBUG] Decode failed (waiting for more data): ${e as any}`)
        break
      }
    }
  }
}
