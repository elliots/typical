/**
 * Go WebAssembly runtime.
 * This is a TypeScript port of Go's wasm_exec.js for running Go WASM binaries.
 *
 * Based on tsgo-wasm (https://github.com/sxzz/tsgo-wasm)
 * Copyright (c) 2025 sxzz
 * Licensed under Apache License 2.0
 *
 * Original Go wasm_exec.js is part of the Go project.
 * Copyright (c) The Go Authors
 * Licensed under BSD 3-Clause License
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

interface GoExports {
  mem: WebAssembly.Memory
  run(argc: number, argv: number): void
  resume(): void
  getsp(): number
  testExport0?(): void
  testExport?(a: number, b: number): number
}

interface PendingEvent {
  id: number
  this: unknown
  args: IArguments
  result?: unknown
}

export class Go {
  argv: string[] = ['js']
  env: Record<string, string> = {}
  exit: (code: number) => void = () => {}

  private _exitPromise: Promise<void>
  private _resolveExitPromise!: () => void
  private _pendingEvent: PendingEvent | null = null
  private _scheduledTimeouts: Map<number, ReturnType<typeof setTimeout>> = new Map()
  private _nextCallbackTimeoutID = 1

  private _inst!: WebAssembly.Instance
  private _values!: unknown[]
  private _goRefCounts!: number[]
  private _ids!: Map<unknown, number>
  private _idPool!: number[]

  mem!: DataView
  exited = false
  importObject: WebAssembly.Imports

  constructor() {
    this._exitPromise = new Promise((resolve) => {
      this._resolveExitPromise = resolve
    })

    const setInt64 = (addr: number, v: number) => {
      this.mem.setUint32(addr + 0, v, true)
      this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true)
    }

    const getInt64 = (addr: number): number => {
      const low = this.mem.getUint32(addr + 0, true)
      const high = this.mem.getInt32(addr + 4, true)
      return low + high * 4294967296
    }

    const loadValue = (addr: number): unknown => {
      const f = this.mem.getFloat64(addr, true)
      if (f === 0) {
        return undefined
      }
      if (!isNaN(f)) {
        return f
      }

      const id = this.mem.getUint32(addr, true)
      return this._values[id]
    }

    const storeValue = (addr: number, v: unknown) => {
      const nanHead = 0x7ff80000

      if (typeof v === 'number' && v !== 0) {
        if (isNaN(v)) {
          this.mem.setUint32(addr + 4, nanHead, true)
          this.mem.setUint32(addr, 0, true)
          return
        }
        this.mem.setFloat64(addr, v, true)
        return
      }

      if (v === undefined) {
        this.mem.setFloat64(addr, 0, true)
        return
      }

      let id = this._ids.get(v)
      if (id === undefined) {
        id = this._idPool.pop()
        if (id === undefined) {
          id = this._values.length
        }
        this._values[id] = v
        this._goRefCounts[id] = 0
        this._ids.set(v, id)
      }
      this._goRefCounts[id]++
      let typeFlag = 0
      switch (typeof v) {
        case 'object':
          if (v !== null) {
            typeFlag = 1
          }
          break
        case 'string':
          typeFlag = 2
          break
        case 'symbol':
          typeFlag = 3
          break
        case 'function':
          typeFlag = 4
          break
      }
      this.mem.setUint32(addr + 4, nanHead | typeFlag, true)
      this.mem.setUint32(addr, id, true)
    }

    const loadSlice = (addr: number): Uint8Array => {
      const array = getInt64(addr + 0)
      const len = getInt64(addr + 8)
      return new Uint8Array((this._inst.exports as unknown as GoExports).mem.buffer, array, len)
    }

    const loadSliceOfValues = (addr: number): unknown[] => {
      const array = getInt64(addr + 0)
      const len = getInt64(addr + 8)
      const a = new Array(len)
      for (let i = 0; i < len; i++) {
        a[i] = loadValue(array + i * 8)
      }
      return a
    }

    const loadString = (addr: number): string => {
      const saddr = getInt64(addr + 0)
      const len = getInt64(addr + 8)
      return decoder.decode(new DataView((this._inst.exports as unknown as GoExports).mem.buffer, saddr, len))
    }

    const testCallExport = (a: number, b: number): number => {
      const exports = this._inst.exports as unknown as GoExports
      exports.testExport0?.()
      return exports.testExport?.(a, b) ?? 0
    }

    const timeOrigin = Date.now() - performance.now()

    this.importObject = {
      _gotest: {
        add: (a: number, b: number) => a + b,
        callExport: testCallExport,
      },
      gojs: {
        // func wasmExit(code int32)
        'runtime.wasmExit': (sp: number) => {
          sp >>>= 0
          const code = this.mem.getInt32(sp + 8, true)
          this.exited = true
          delete (this as any)._inst
          delete (this as any)._values
          delete (this as any)._goRefCounts
          delete (this as any)._ids
          delete (this as any)._idPool
          this.exit(code)
        },

        // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
        'runtime.wasmWrite': (sp: number) => {
          sp >>>= 0
          const fd = getInt64(sp + 8)
          const p = getInt64(sp + 16)
          const n = this.mem.getInt32(sp + 24, true)
          const data = new Uint8Array((this._inst.exports as unknown as GoExports).mem.buffer, p, n)
          // Handle stdout/stderr specially - always go to console
          // Other fds use the filesystem
          if (fd === 1 || fd === 2) {
            const text = decoder.decode(data)
            console.log('[GO fd=' + fd + ']', text)
          } else {
            const fs = (globalThis as any).fs
            if (fs?.writeSync) {
              fs.writeSync(fd, data)
            }
          }
        },

        // func resetMemoryDataView()
        'runtime.resetMemoryDataView': (sp: number) => {
          sp >>>= 0
          this.mem = new DataView((this._inst.exports as unknown as GoExports).mem.buffer)
        },

        // func nanotime1() int64
        'runtime.nanotime1': (sp: number) => {
          sp >>>= 0
          setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000)
        },

        // func walltime() (sec int64, nsec int32)
        'runtime.walltime': (sp: number) => {
          sp >>>= 0
          const msec = new Date().getTime()
          setInt64(sp + 8, msec / 1000)
          this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true)
        },

        // func scheduleTimeoutEvent(delay int64) int32
        'runtime.scheduleTimeoutEvent': (sp: number) => {
          sp >>>= 0
          const id = this._nextCallbackTimeoutID
          this._nextCallbackTimeoutID++
          this._scheduledTimeouts.set(
            id,
            setTimeout(() => {
              this._resume()
              while (this._scheduledTimeouts.has(id)) {
                console.warn('scheduleTimeoutEvent: missed timeout event')
                this._resume()
              }
            }, getInt64(sp + 8)),
          )
          this.mem.setInt32(sp + 16, id, true)
        },

        // func clearTimeoutEvent(id int32)
        'runtime.clearTimeoutEvent': (sp: number) => {
          sp >>>= 0
          const id = this.mem.getInt32(sp + 8, true)
          clearTimeout(this._scheduledTimeouts.get(id))
          this._scheduledTimeouts.delete(id)
        },

        // func getRandomData(r []byte)
        'runtime.getRandomData': (sp: number) => {
          sp >>>= 0
          crypto.getRandomValues(loadSlice(sp + 8))
        },

        // func finalizeRef(v ref)
        'syscall/js.finalizeRef': (sp: number) => {
          sp >>>= 0
          const id = this.mem.getUint32(sp + 8, true)
          this._goRefCounts[id]--
          if (this._goRefCounts[id] === 0) {
            const v = this._values[id]
            this._values[id] = null
            this._ids.delete(v)
            this._idPool.push(id)
          }
        },

        // func stringVal(value string) ref
        'syscall/js.stringVal': (sp: number) => {
          sp >>>= 0
          storeValue(sp + 24, loadString(sp + 8))
        },

        // func valueGet(v ref, p string) ref
        'syscall/js.valueGet': (sp: number) => {
          sp >>>= 0
          const result = Reflect.get(loadValue(sp + 8) as object, loadString(sp + 16))
          sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
          storeValue(sp + 32, result)
        },

        // func valueSet(v ref, p string, x ref)
        'syscall/js.valueSet': (sp: number) => {
          sp >>>= 0
          Reflect.set(loadValue(sp + 8) as object, loadString(sp + 16), loadValue(sp + 32))
        },

        // func valueDelete(v ref, p string)
        'syscall/js.valueDelete': (sp: number) => {
          sp >>>= 0
          Reflect.deleteProperty(loadValue(sp + 8) as object, loadString(sp + 16))
        },

        // func valueIndex(v ref, i int) ref
        'syscall/js.valueIndex': (sp: number) => {
          sp >>>= 0
          storeValue(sp + 24, Reflect.get(loadValue(sp + 8) as object, getInt64(sp + 16)))
        },

        // valueSetIndex(v ref, i int, x ref)
        'syscall/js.valueSetIndex': (sp: number) => {
          sp >>>= 0
          Reflect.set(loadValue(sp + 8) as object, getInt64(sp + 16), loadValue(sp + 24))
        },

        // func valueCall(v ref, m string, args []ref) (ref, bool)
        'syscall/js.valueCall': (sp: number) => {
          sp >>>= 0
          try {
            const v = loadValue(sp + 8) as object
            const m = Reflect.get(v, loadString(sp + 16)) as (...args: unknown[]) => unknown
            const args = loadSliceOfValues(sp + 32)
            const result = Reflect.apply(m, v, args)
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 56, result)
            this.mem.setUint8(sp + 64, 1)
          } catch (err) {
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 56, err)
            this.mem.setUint8(sp + 64, 0)
          }
        },

        // func valueInvoke(v ref, args []ref) (ref, bool)
        'syscall/js.valueInvoke': (sp: number) => {
          sp >>>= 0
          try {
            const v = loadValue(sp + 8) as (...args: unknown[]) => unknown
            const args = loadSliceOfValues(sp + 16)
            const result = Reflect.apply(v, undefined, args)
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 40, result)
            this.mem.setUint8(sp + 48, 1)
          } catch (err) {
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 40, err)
            this.mem.setUint8(sp + 48, 0)
          }
        },

        // func valueNew(v ref, args []ref) (ref, bool)
        'syscall/js.valueNew': (sp: number) => {
          sp >>>= 0
          try {
            const v = loadValue(sp + 8) as new (...args: unknown[]) => unknown
            const args = loadSliceOfValues(sp + 16)
            const result = Reflect.construct(v, args)
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 40, result)
            this.mem.setUint8(sp + 48, 1)
          } catch (err) {
            sp = (this._inst.exports as unknown as GoExports).getsp() >>> 0
            storeValue(sp + 40, err)
            this.mem.setUint8(sp + 48, 0)
          }
        },

        // func valueLength(v ref) int
        'syscall/js.valueLength': (sp: number) => {
          sp >>>= 0
          setInt64(sp + 16, (loadValue(sp + 8) as { length: number }).length)
        },

        // valuePrepareString(v ref) (ref, int)
        'syscall/js.valuePrepareString': (sp: number) => {
          sp >>>= 0
          const str = encoder.encode(String(loadValue(sp + 8)))
          storeValue(sp + 16, str)
          setInt64(sp + 24, str.length)
        },

        // valueLoadString(v ref, b []byte)
        'syscall/js.valueLoadString': (sp: number) => {
          sp >>>= 0
          const str = loadValue(sp + 8) as Uint8Array
          loadSlice(sp + 16).set(str)
        },

        // func valueInstanceOf(v ref, t ref) bool
        'syscall/js.valueInstanceOf': (sp: number) => {
          sp >>>= 0
          this.mem.setUint8(
            sp + 24,
            (loadValue(sp + 8) as object) instanceof (loadValue(sp + 16) as new (...args: any[]) => any) ? 1 : 0,
          )
        },

        // func copyBytesToGo(dst []byte, src ref) (int, bool)
        'syscall/js.copyBytesToGo': (sp: number) => {
          sp >>>= 0
          const dst = loadSlice(sp + 8)
          const src = loadValue(sp + 32)
          if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
            this.mem.setUint8(sp + 48, 0)
            return
          }
          const toCopy = src.subarray(0, dst.length)
          dst.set(toCopy)
          setInt64(sp + 40, toCopy.length)
          this.mem.setUint8(sp + 48, 1)
        },

        // func copyBytesToJS(dst ref, src []byte) (int, bool)
        'syscall/js.copyBytesToJS': (sp: number) => {
          sp >>>= 0
          const dst = loadValue(sp + 8)
          const src = loadSlice(sp + 16)
          if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
            this.mem.setUint8(sp + 48, 0)
            return
          }
          const toCopy = src.subarray(0, dst.length)
          dst.set(toCopy)
          setInt64(sp + 40, toCopy.length)
          this.mem.setUint8(sp + 48, 1)
        },

        debug: (value: number) => {
          console.log(value)
        },
      },
    }
  }

  async run(instance: WebAssembly.Instance): Promise<void> {
    if (!(instance instanceof WebAssembly.Instance)) {
      throw new Error('Go.run: WebAssembly.Instance expected')
    }
    this._inst = instance
    const exports = this._inst.exports as unknown as GoExports
    this.mem = new DataView(exports.mem.buffer)
    this._values = [
      // JS values that Go currently has references to, indexed by reference id
      NaN,
      0,
      null,
      true,
      false,
      globalThis,
      this,
    ]
    this._goRefCounts = new Array(this._values.length).fill(Infinity)
    this._ids = new Map<unknown, number>([
      [0, 1],
      [null, 2],
      [true, 3],
      [false, 4],
      [globalThis, 5],
      [this, 6],
    ])
    this._idPool = []
    this.exited = false

    // Pass command line arguments and environment variables to WebAssembly
    let offset = 4096

    const strPtr = (str: string): number => {
      const ptr = offset
      const bytes = encoder.encode(str + '\0')
      new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes)
      offset += bytes.length
      if (offset % 8 !== 0) {
        offset += 8 - (offset % 8)
      }
      return ptr
    }

    const argc = this.argv.length

    const argvPtrs: number[] = []
    this.argv.forEach((arg) => {
      argvPtrs.push(strPtr(arg))
    })
    argvPtrs.push(0)

    const keys = Object.keys(this.env).sort()
    keys.forEach((key) => {
      argvPtrs.push(strPtr(`${key}=${this.env[key]}`))
    })
    argvPtrs.push(0)

    const argv = offset
    argvPtrs.forEach((ptr) => {
      this.mem.setUint32(offset, ptr, true)
      this.mem.setUint32(offset + 4, 0, true)
      offset += 8
    })

    const wasmMinDataAddr = 4096 + 8192
    if (offset >= wasmMinDataAddr) {
      throw new Error('total length of command line and environment variables exceeds limit')
    }

    exports.run(argc, argv)
    if (this.exited) {
      this._resolveExitPromise()
    }
    await this._exitPromise
  }

  _resume(): void {
    if (this.exited) {
      throw new Error('Go program has already exited')
    }
    const exports = this._inst.exports as unknown as GoExports
    exports.resume()
    if (this.exited) {
      this._resolveExitPromise()
    }
  }

  _makeFuncWrapper(id: number): (...args: unknown[]) => unknown {
    const go = this
    return function (this: unknown) {
      const event: PendingEvent = { id: id, this: this, args: arguments }
      go._pendingEvent = event
      go._resume()
      return event.result
    }
  }
}
