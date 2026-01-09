/**
 * Synchronous filesystem wrapper for Go WASM.
 *
 * Go's syscall/fs_js.go expects callback-based fs methods, but the callback
 * is called from within a js.FuncOf handler. If we use async callbacks,
 * this creates a deadlock because:
 * 1. JS calls Go function
 * 2. Go calls fs.mkdir(path, mode, callback)
 * 3. Go waits for callback on a channel
 * 4. But JS event loop is blocked waiting for Go function to return
 * 5. Deadlock!
 *
 * The solution is to call the callback SYNCHRONOUSLY using sync fs methods.
 * This wrapper provides callback-based methods that internally use sync operations.
 */

import * as fsSync from 'node:fs'

type Callback<T = void> = (err: NodeJS.ErrnoException | null, result?: T) => void

export interface SyncFS {
  constants: typeof fsSync.constants
  mkdir: (path: string, mode: number, callback: Callback) => void
  open: (path: string, flags: number, mode: number, callback: Callback<number>) => void
  close: (fd: number, callback: Callback) => void
  fstat: (fd: number, callback: Callback<fsSync.Stats>) => void
  stat: (path: string, callback: Callback<fsSync.Stats>) => void
  lstat: (path: string, callback: Callback<fsSync.Stats>) => void
  unlink: (path: string, callback: Callback) => void
  rmdir: (path: string, callback: Callback) => void
  chmod: (path: string, mode: number, callback: Callback) => void
  fchmod: (fd: number, mode: number, callback: Callback) => void
  chown: (path: string, uid: number, gid: number, callback: Callback) => void
  fchown: (fd: number, uid: number, gid: number, callback: Callback) => void
  lchown: (path: string, uid: number, gid: number, callback: Callback) => void
  utimes: (path: string, atime: number, mtime: number, callback: Callback) => void
  rename: (from: string, to: string, callback: Callback) => void
  truncate: (path: string, length: number, callback: Callback) => void
  ftruncate: (fd: number, length: number, callback: Callback) => void
  readlink: (path: string, callback: Callback<string>) => void
  symlink: (target: string, path: string, callback: Callback) => void
  link: (existingPath: string, newPath: string, callback: Callback) => void
  readdir: (path: string, callback: Callback<string[]>) => void
  read: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: Callback<number>
  ) => void
  write: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: Callback<number>
  ) => void
  writeSync: typeof fsSync.writeSync
  fsync: (fd: number, callback: Callback) => void
}

/**
 * Creates a synchronous filesystem wrapper for Go WASM.
 * All methods call their callbacks synchronously to avoid deadlocks.
 */
export function createSyncFS(): SyncFS {
  return {
    constants: fsSync.constants,

    mkdir: (path, mode, callback) => {
      try {
        fsSync.mkdirSync(path, { mode })
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    open: (path, flags, mode, callback) => {
      try {
        const fd = fsSync.openSync(path, flags, mode)
        callback(null, fd)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    close: (fd, callback) => {
      try {
        fsSync.closeSync(fd)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    fstat: (fd, callback) => {
      try {
        const stat = fsSync.fstatSync(fd)
        callback(null, stat)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    stat: (path, callback) => {
      try {
        const stat = fsSync.statSync(path)
        callback(null, stat)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    lstat: (path, callback) => {
      try {
        const stat = fsSync.lstatSync(path)
        callback(null, stat)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    unlink: (path, callback) => {
      try {
        fsSync.unlinkSync(path)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    rmdir: (path, callback) => {
      try {
        fsSync.rmdirSync(path)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    chmod: (path, mode, callback) => {
      try {
        fsSync.chmodSync(path, mode)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    fchmod: (fd, mode, callback) => {
      try {
        fsSync.fchmodSync(fd, mode)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    chown: (path, uid, gid, callback) => {
      try {
        fsSync.chownSync(path, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    fchown: (fd, uid, gid, callback) => {
      try {
        fsSync.fchownSync(fd, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    lchown: (path, uid, gid, callback) => {
      try {
        fsSync.lchownSync(path, uid, gid)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    utimes: (path, atime, mtime, callback) => {
      try {
        fsSync.utimesSync(path, atime, mtime)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    rename: (from, to, callback) => {
      try {
        fsSync.renameSync(from, to)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    truncate: (path, length, callback) => {
      try {
        fsSync.truncateSync(path, length)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    ftruncate: (fd, length, callback) => {
      try {
        fsSync.ftruncateSync(fd, length)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    readlink: (path, callback) => {
      try {
        const result = fsSync.readlinkSync(path)
        callback(null, result)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    symlink: (target, path, callback) => {
      try {
        fsSync.symlinkSync(target, path)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    link: (existingPath, newPath, callback) => {
      try {
        fsSync.linkSync(existingPath, newPath)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    readdir: (path, callback) => {
      try {
        const result = fsSync.readdirSync(path)
        callback(null, result)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    read: (fd, buffer, offset, length, position, callback) => {
      try {
        const bytesRead = fsSync.readSync(fd, buffer, offset, length, position)
        callback(null, bytesRead)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    write: (fd, buffer, offset, length, position, callback) => {
      try {
        const bytesWritten = fsSync.writeSync(fd, buffer, offset, length, position)
        callback(null, bytesWritten)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },

    writeSync: fsSync.writeSync,

    fsync: (fd, callback) => {
      try {
        fsSync.fsyncSync(fd)
        callback(null)
      } catch (err) {
        callback(err as NodeJS.ErrnoException)
      }
    },
  }
}

/**
 * Install the synchronous filesystem wrapper on globalThis.
 * This must be called before instantiating Go WASM.
 */
export function installSyncFS(): void {
  ;(globalThis as any).fs = createSyncFS()
}
