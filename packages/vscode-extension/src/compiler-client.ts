import { spawn, ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, accessSync } from 'node:fs'
import type { ProjectHandle, AnalyseResult, TransformResult } from './types'

const debug = process.env.DEBUG === '1'

function debugLog(...args: unknown[]): void {
  if (debug) {
    console.error('[TYPICAL-EXT]', ...args)
  }
}

// MessagePack-like protocol constants (must match Go's protocol.go)
const enum MessageType {
  Unknown = 0,
  Request = 1,
  CallResponse = 2,
  CallError = 3,
  Response = 4,
  Error = 5,
  Call = 6,
}

/**
 * Find the Typical Go binary from the project's node_modules.
 * Returns null if not found (project doesn't use Typical).
 */
export function findBinary(workspaceRoot: string): string | null {
  const platform = process.platform // darwin, linux, win32
  const arch = process.arch // arm64, x64
  const binaryName = platform === 'win32' ? 'typical.exe' : 'typical'

  // Paths to check in order of preference
  const candidates = [
    // Standard node_modules location (published packages)
    join(workspaceRoot, 'node_modules', `@elliots/typical-compiler-${platform}-${arch}`, 'bin', binaryName),
    // Monorepo development: packages/compiler-{platform}-{arch}/bin/typical
    join(workspaceRoot, 'packages', `compiler-${platform}-${arch}`, 'bin', binaryName),
    // Monorepo development: packages/compiler/bin/typical (local build)
    join(workspaceRoot, 'packages', 'compiler', 'bin', binaryName),
  ]

  for (const candidate of candidates) {
    debugLog('Looking for binary at:', candidate)
    try {
      accessSync(candidate)
      debugLog('Found binary at:', candidate)
      return candidate
    } catch {
      // Try next candidate
    }
  }

  debugLog('Binary not found in any location')
  return null
}

/**
 * Check if a workspace has Typical as a dependency.
 */
export function hasTypicalDependency(workspaceRoot: string): boolean {
  const packageJsonPath = join(workspaceRoot, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return false
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(packageJsonPath)
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    }
    return '@elliots/typical' in deps || '@elliots/typical-compiler' in deps
  } catch {
    return false
  }
}

/**
 * Client for communicating with the Typical Go compiler binary.
 */
export class CompilerClient {
  private process: ChildProcess | null = null
  private pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map()
  private buffer: Buffer = Buffer.alloc(0)
  private nextRequestId = 0

  constructor(
    private binaryPath: string,
    private cwd: string,
  ) {}

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Compiler already started')
    }

    debugLog('Starting compiler:', this.binaryPath, '--cwd', this.cwd)

    this.process = spawn(this.binaryPath, ['--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, DEBUG: '1' },
    })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.handleData(data)
    })

    this.process.on('error', err => {
      console.error('Typical compiler process error:', err)
    })

    this.process.on('exit', code => {
      debugLog('Compiler exited with code:', code)
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

    debugLog('Compiler started successfully')
  }

  async stop(): Promise<void> {
    if (this.process) {
      const proc = this.process
      this.process = null
      this.pendingRequests.clear()
      proc.stdin?.end()
      proc.kill()
      debugLog('Compiler stopped')
    }
  }

  isRunning(): boolean {
    return this.process !== null
  }

  async loadProject(configFileName: string): Promise<ProjectHandle> {
    return this.request<ProjectHandle>('loadProject', { configFileName })
  }

  async analyseFile(project: ProjectHandle | string, fileName: string, content?: string, ignoreTypes?: string[]): Promise<AnalyseResult> {
    const projectId = typeof project === 'string' ? project : project.id
    return this.request<AnalyseResult>('analyseFile', {
      project: projectId,
      fileName,
      content,
      ignoreTypes,
    })
  }

  async transformFile(project: ProjectHandle | string, fileName: string, content?: string): Promise<TransformResult> {
    const projectId = typeof project === 'string' ? project : project.id
    return this.request<TransformResult>('transformFile', {
      project: projectId,
      fileName,
      content,
    })
  }

  async release(handle: ProjectHandle | string): Promise<void> {
    const id = typeof handle === 'string' ? handle : handle.id
    await this.request<null>('release', id)
  }

  private async request<T>(method: string, payload: unknown): Promise<T> {
    if (!this.process) {
      throw new Error('Compiler not started')
    }

    const requestId = `${method}:${this.nextRequestId++}`
    const requestData = this.encodeRequest(requestId, payload)

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      this.process!.stdin!.write(requestData)
    })
  }

  private encodeRequest(method: string, payload: unknown): Buffer {
    const methodBuf = Buffer.from(method, 'utf8')
    const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8')

    // Calculate total size
    // [0x93] [0xCC type] [method bin] [payload bin]
    let size = 1 + 2 // array marker + type

    // Method bin size
    if (methodBuf.length < 256) {
      size += 2 + methodBuf.length
    } else if (methodBuf.length < 65536) {
      size += 3 + methodBuf.length
    } else {
      size += 5 + methodBuf.length
    }

    // Payload bin size
    if (payloadBuf.length < 256) {
      size += 2 + payloadBuf.length
    } else if (payloadBuf.length < 65536) {
      size += 3 + payloadBuf.length
    } else {
      size += 5 + payloadBuf.length
    }

    const buf = Buffer.alloc(size)
    let offset = 0

    // Fixed array marker (3 elements)
    buf[offset++] = 0x93

    // Message type (Request = 1)
    buf[offset++] = 0xcc
    buf[offset++] = MessageType.Request

    // Method (bin)
    offset = this.writeBin(buf, offset, methodBuf)

    // Payload (bin)
    offset = this.writeBin(buf, offset, payloadBuf)

    return buf
  }

  private writeBin(buf: Buffer, offset: number, data: Buffer): number {
    const len = data.length

    if (len < 256) {
      buf[offset++] = 0xc4 // bin8
      buf[offset++] = len
    } else if (len < 65536) {
      buf[offset++] = 0xc5 // bin16
      buf.writeUInt16BE(len, offset)
      offset += 2
    } else {
      buf[offset++] = 0xc6 // bin32
      buf.writeUInt32BE(len, offset)
      offset += 4
    }

    data.copy(buf, offset)
    return offset + len
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])

    while (this.buffer.length > 0) {
      try {
        const result = this.decodeResponse(this.buffer)
        if (!result) {
          break // Need more data
        }

        const { messageType, method, payload, bytesConsumed } = result

        const pending = this.pendingRequests.get(method)
        if (!pending) {
          console.error(`No pending request for method: ${method}`)
          this.buffer = this.buffer.subarray(bytesConsumed)
          continue
        }

        this.pendingRequests.delete(method)

        if (messageType === MessageType.Response) {
          const parsed = payload.length > 0 ? JSON.parse(payload.toString('utf8')) : null
          pending.resolve(parsed)
        } else if (messageType === MessageType.Error) {
          pending.reject(new Error(payload.toString('utf8')))
        } else {
          pending.reject(new Error(`Unexpected message type: ${messageType}`))
        }

        this.buffer = this.buffer.subarray(bytesConsumed)
      } catch {
        break // Need more data or parse error
      }
    }
  }

  private decodeResponse(buf: Buffer): {
    messageType: MessageType
    method: string
    payload: Buffer
    bytesConsumed: number
  } | null {
    if (buf.length < 4) return null

    let offset = 0

    // Array marker
    if (buf[offset++] !== 0x93) {
      throw new Error(`Invalid array marker: ${buf[0]}`)
    }

    // Message type
    if (buf[offset++] !== 0xcc) {
      throw new Error(`Invalid type marker: ${buf[1]}`)
    }
    const messageType = buf[offset++] as MessageType

    // Method (bin)
    const methodResult = this.readBin(buf, offset)
    if (!methodResult) return null
    const method = methodResult.data.toString('utf8')
    offset = methodResult.newOffset

    // Payload (bin)
    const payloadResult = this.readBin(buf, offset)
    if (!payloadResult) return null
    const payload = payloadResult.data
    offset = payloadResult.newOffset

    return { messageType, method, payload, bytesConsumed: offset }
  }

  private readBin(buf: Buffer, offset: number): { data: Buffer; newOffset: number } | null {
    if (offset >= buf.length) return null

    const marker = buf[offset++]
    let size: number

    if (marker === 0xc4) {
      // bin8
      if (offset >= buf.length) return null
      size = buf[offset++]
    } else if (marker === 0xc5) {
      // bin16
      if (offset + 1 >= buf.length) return null
      size = buf.readUInt16BE(offset)
      offset += 2
    } else if (marker === 0xc6) {
      // bin32
      if (offset + 3 >= buf.length) return null
      size = buf.readUInt32BE(offset)
      offset += 4
    } else {
      throw new Error(`Invalid bin marker: ${marker}`)
    }

    if (offset + size > buf.length) return null

    const data = buf.subarray(offset, offset + size)
    return { data, newOffset: offset + size }
  }
}
