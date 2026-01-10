/**
 * WASM-based Typical compiler client.
 * Provides the same interface as TypicalCompiler but runs in browser/Node.js via WebAssembly.
 */

import { Go } from './wasm-exec.js'
import { installSyncFS } from './sync-fs.js'

// Track if we've installed the fs
let fsInstalled = false

export interface RawSourceMap {
  version: number
  file?: string
  sourceRoot?: string
  sources: string[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
}

export interface TransformResult {
  code: string
  sourceMap?: RawSourceMap
}

export interface TransformOptions {
  ignoreTypes?: string[]
  maxGeneratedFunctions?: number
}

export interface WasmTypicalCompilerOptions {
  /**
   * Path or URL to the WASM binary.
   * If not provided, uses the bundled binary.
   */
  wasmPath?: string | URL

  /**
   * Custom fetch function for loading WASM.
   * Useful for custom loaders or caching.
   */
  fetchWasm?: (url: string | URL) => Promise<ArrayBuffer>

  /**
   * Filesystem implementation for Go WASM.
   * Must provide callback-style methods that call callbacks SYNCHRONOUSLY.
   * Use `wrapSyncFSForGo()` to wrap a filesystem with sync methods.
   * In Node.js, this is optional - the native fs will be used.
   */
  fs?: object
}

/**
 * Wraps a filesystem with sync methods (like ZenFS) for Go WASM compatibility.
 *
 * Go's syscall/fs_js.go expects callback-style async methods, but the callback
 * must be called synchronously when used from js.FuncOf handlers to avoid deadlocks.
 *
 * @param syncFs - A filesystem object with sync methods (e.g. from @zenfs/core)
 * @returns A wrapped filesystem suitable for Go WASM
 */
export function wrapSyncFSForGo(syncFs: {
  mkdirSync: (path: string, options?: { mode?: number; recursive?: boolean }) => void
  openSync: (path: string, flags: string | number, mode?: number) => number
  closeSync: (fd: number) => void
  fstatSync: (fd: number) => any
  statSync: (path: string) => any
  lstatSync: (path: string) => any
  unlinkSync: (path: string) => void
  rmdirSync: (path: string) => void
  chmodSync: (path: string, mode: number) => void
  fchmodSync: (fd: number, mode: number) => void
  chownSync: (path: string, uid: number, gid: number) => void
  fchownSync: (fd: number, uid: number, gid: number) => void
  lchownSync: (path: string, uid: number, gid: number) => void
  utimesSync: (path: string, atime: number | Date, mtime: number | Date) => void
  renameSync: (from: string, to: string) => void
  truncateSync: (path: string, length: number) => void
  ftruncateSync: (fd: number, length: number) => void
  readlinkSync: (path: string) => string
  symlinkSync: (target: string, path: string) => void
  linkSync: (existingPath: string, newPath: string) => void
  readdirSync: (path: string, options?: { withFileTypes?: boolean }) => any[]
  readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => number
  writeSync: (fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number | null) => number
  fsyncSync: (fd: number) => void
  constants: { O_RDONLY: number; O_WRONLY: number; O_RDWR: number; O_CREAT: number; O_TRUNC: number; O_APPEND: number; O_EXCL: number }
}): object {
  type Callback<T = void> = (err: Error | null, result?: T) => void

  return {
    constants: syncFs.constants,

    mkdir: (path: string, mode: number, callback: Callback) => {
      try {
        syncFs.mkdirSync(path, { mode })
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    open: (path: string, flags: number, mode: number, callback: Callback<number>) => {
      console.log('[FS DEBUG] open called:', path, 'flags:', flags)
      try {
        const fd = syncFs.openSync(path, flags, mode)
        console.log('[FS DEBUG] open success, fd:', fd)
        callback(null, fd)
      } catch (err) {
        console.log('[FS DEBUG] open error:', err)
        callback(err as Error)
      }
    },

    close: (fd: number, callback: Callback) => {
      try {
        syncFs.closeSync(fd)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    fstat: (fd: number, callback: Callback<any>) => {
      try {
        const stat = syncFs.fstatSync(fd)
        callback(null, stat)
      } catch (err) {
        callback(err as Error)
      }
    },

    stat: (path: string, callback: Callback<any>) => {
      try {
        const stat = syncFs.statSync(path)
        callback(null, stat)
      } catch (err) {
        callback(err as Error)
      }
    },

    lstat: (path: string, callback: Callback<any>) => {
      try {
        const stat = syncFs.lstatSync(path)
        callback(null, stat)
      } catch (err) {
        callback(err as Error)
      }
    },

    unlink: (path: string, callback: Callback) => {
      try {
        syncFs.unlinkSync(path)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    rmdir: (path: string, callback: Callback) => {
      try {
        syncFs.rmdirSync(path)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    chmod: (path: string, mode: number, callback: Callback) => {
      try {
        syncFs.chmodSync(path, mode)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    fchmod: (fd: number, mode: number, callback: Callback) => {
      try {
        syncFs.fchmodSync(fd, mode)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    chown: (path: string, uid: number, gid: number, callback: Callback) => {
      try {
        syncFs.chownSync(path, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    fchown: (fd: number, uid: number, gid: number, callback: Callback) => {
      try {
        syncFs.fchownSync(fd, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    lchown: (path: string, uid: number, gid: number, callback: Callback) => {
      try {
        syncFs.lchownSync(path, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    utimes: (path: string, atime: number, mtime: number, callback: Callback) => {
      try {
        syncFs.utimesSync(path, atime, mtime)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    rename: (from: string, to: string, callback: Callback) => {
      try {
        syncFs.renameSync(from, to)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    truncate: (path: string, length: number, callback: Callback) => {
      try {
        syncFs.truncateSync(path, length)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    ftruncate: (fd: number, length: number, callback: Callback) => {
      try {
        syncFs.ftruncateSync(fd, length)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    readlink: (path: string, callback: Callback<string>) => {
      try {
        const result = syncFs.readlinkSync(path)
        callback(null, result)
      } catch (err) {
        callback(err as Error)
      }
    },

    symlink: (target: string, path: string, callback: Callback) => {
      try {
        syncFs.symlinkSync(target, path)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    link: (existingPath: string, newPath: string, callback: Callback) => {
      try {
        syncFs.linkSync(existingPath, newPath)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },

    readdir: (path: string, callback: Callback<string[]>) => {
      console.log('[FS DEBUG] readdir called:', path)
      try {
        const result = syncFs.readdirSync(path)
        console.log('[FS DEBUG] readdir result:', result)
        callback(null, result as string[])
      } catch (err) {
        console.log('[FS DEBUG] readdir error:', err)
        callback(err as Error)
      }
    },

    // Sync version for direct calls from Go via syscall/js
    readdirSync: (path: string, options?: { withFileTypes?: boolean }) => {
      console.log('[FS DEBUG] readdirSync called:', path, 'options:', options)
      try {
        const result = syncFs.readdirSync(path, options)
        console.log('[FS DEBUG] readdirSync result:', result)
        return result
      } catch (err) {
        console.log('[FS DEBUG] readdirSync error:', err)
        throw err
      }
    },

    read: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: Callback<number>) => {
      try {
        const bytesRead = syncFs.readSync(fd, buffer, offset, length, position)
        callback(null, bytesRead)
      } catch (err) {
        callback(err as Error)
      }
    },

    write: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: Callback<number>) => {
      // Handle stdout/stderr specially - write to console
      if (fd === 1 || fd === 2) {
        const text = new TextDecoder().decode(buffer.subarray(offset, offset + length))
        console.log('[GO fd=' + fd + ']', text)
        callback(null, length)
        return
      }
      try {
        const bytesWritten = syncFs.writeSync(fd, buffer, offset, length, position)
        callback(null, bytesWritten)
      } catch (err) {
        callback(err as Error)
      }
    },

    writeSync: (fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number | null) => {
      // Handle stdout/stderr specially - write to console
      if (fd === 1 || fd === 2) {
        const actualOffset = offset ?? 0
        const actualLength = length ?? buffer.length
        const text = new TextDecoder().decode(buffer.subarray(actualOffset, actualOffset + actualLength))
        console.log('[GO fd=' + fd + ']', text)
        return actualLength
      }
      return syncFs.writeSync(fd, buffer, offset, length, position)
    },

    fsync: (fd: number, callback: Callback) => {
      try {
        syncFs.fsyncSync(fd)
        callback(null)
      } catch (err) {
        callback(err as Error)
      }
    },
  }
}

/**
 * WASM-based Typical compiler.
 * Use this when native binaries are unavailable or for browser environments.
 */
export class WasmTypicalCompiler {
  private go: Go | null = null
  private instance: WebAssembly.Instance | null = null
  private options: WasmTypicalCompilerOptions
  private ready = false

  constructor(options: WasmTypicalCompilerOptions = {}) {
    this.options = options
  }

  /**
   * Start the WASM compiler.
   * Loads and instantiates the WebAssembly module.
   */
  async start(): Promise<void> {
    if (this.ready) {
      throw new Error('Compiler already started')
    }

    // Install filesystem for Go WASM - required before WebAssembly.instantiate()
    // because Go's syscall/fs_js.go accesses globalThis.fs during init()
    if (!fsInstalled) {
      if (this.options.fs) {
        // Use provided filesystem (e.g. ZenFS for browser)
        ;(globalThis as any).fs = this.options.fs
        // Also install path and process stubs if not already present
        if (!(globalThis as any).path) {
          ;(globalThis as any).path = {
            join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/',
            dirname: (p: string) => {
              const parts = p.split('/')
              parts.pop()
              return parts.join('/') || '/'
            },
            basename: (p: string) => p.split('/').pop() || '',
            resolve: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
          }
        }
        if (!(globalThis as any).process) {
          ;(globalThis as any).process = {
            pid: 1,
            ppid: 0,
            getuid: () => 0,
            getgid: () => 0,
            geteuid: () => 0,
            getegid: () => 0,
            getgroups: () => [],
            cwd: () => '/tmp',
            chdir: () => {},
            umask: () => 0o022,
          }
        }
      } else if (typeof process !== 'undefined' && typeof process.versions?.node !== 'undefined') {
        // Node.js: use synchronous filesystem wrapper to prevent deadlocks
        // Go's syscall/fs_js.go uses async callbacks, which deadlock when called from js.FuncOf handlers
        installSyncFS()
      } else {
        // Browser without provided fs: require ZenFS
        throw new Error('Browser environment requires a filesystem. ' + 'Use wrapSyncFSForGo() with @zenfs/core and pass it via the fs option.')
      }
      fsInstalled = true
    }

    // Determine WASM path
    const wasmPath = this.options.wasmPath ?? new URL('../bin/typical.wasm', import.meta.url)

    // Load WASM binary
    let wasmBuffer: ArrayBuffer
    if (this.options.fetchWasm) {
      wasmBuffer = await this.options.fetchWasm(wasmPath)
    } else if (wasmPath instanceof URL && wasmPath.protocol === 'file:') {
      // Node.js with file:// URL - use fs.readFileSync
      const fs = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const filePath = fileURLToPath(wasmPath)
      wasmBuffer = fs.readFileSync(filePath).buffer
    } else if (typeof fetch !== 'undefined' && !(wasmPath instanceof URL && wasmPath.protocol === 'file:')) {
      const response = await fetch(wasmPath)
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`)
      }
      wasmBuffer = await response.arrayBuffer()
    } else {
      // Fallback for Node.js
      const fs = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const url = wasmPath instanceof URL ? wasmPath : new URL(wasmPath, import.meta.url)
      const filePath = url.protocol === 'file:' ? fileURLToPath(url) : url.toString()
      wasmBuffer = fs.readFileSync(filePath).buffer
    }

    // Create Go runtime
    this.go = new Go()
    this.go.argv = ['typical']
    // Pass minimal environment variables to Go
    // Full process.env can exceed WASM limits
    const env: Record<string, string> = {}
    if (typeof process !== 'undefined' && process.env) {
      // Only pass essential vars
      if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR
      if (process.env.HOME) env.HOME = process.env.HOME
      if (process.env.PATH) env.PATH = process.env.PATH
      // Ensure TMPDIR is set
      if (!env.TMPDIR) {
        const os = await import('node:os')
        env.TMPDIR = os.tmpdir()
      }
    } else {
      env.TMPDIR = '/tmp'
    }
    this.go.env = env

    // Compile and instantiate
    const result = await WebAssembly.instantiate(wasmBuffer, this.go.importObject)
    this.instance = result.instance

    // Run Go main() - this will register global functions and block
    // We run it in the background since it never returns
    const runPromise = this.go.run(this.instance)

    // Give Go time to initialise and register global functions
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check if the transform function was registered
    if (typeof (globalThis as any).typicalTransformSource !== 'function') {
      // If not ready yet, wait a bit more
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (typeof (globalThis as any).typicalTransformSource !== 'function') {
      throw new Error('WASM module did not register typicalTransformSource function')
    }

    this.ready = true

    // Handle exit (though the program should stay alive)
    runPromise.catch(err => {
      console.error('Go runtime exited:', err)
      this.ready = false
    })
  }

  /**
   * Close the compiler.
   * Releases WASM resources.
   */
  async close(): Promise<void> {
    this.ready = false
    this.go = null
    this.instance = null
  }

  /**
   * Transform a standalone TypeScript source string.
   *
   * @param fileName - Virtual filename for error messages
   * @param source - TypeScript source code
   * @param options - Transform options
   * @returns Transformed code with validation
   */
  async transformSource(fileName: string, source: string, options?: TransformOptions): Promise<TransformResult> {
    if (!this.ready) {
      throw new Error('Compiler not started')
    }

    const transformFn = (globalThis as any).typicalTransformSource
    if (typeof transformFn !== 'function') {
      throw new Error('typicalTransformSource function not available')
    }

    // Call the Go function
    const optionsJson = JSON.stringify(options ?? {})
    const resultJson = transformFn(fileName, source, optionsJson)

    // Parse the result
    const result = JSON.parse(resultJson)

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      code: result.code,
      sourceMap: result.sourceMap,
    }
  }
}
