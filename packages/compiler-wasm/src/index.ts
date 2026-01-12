/**
 * Typical WASM Compiler Package
 *
 * Provides a browser and Node.js compatible compiler using WebAssembly.
 */

export { WasmTypicalCompiler, wrapSyncFSForGo } from "./client.js";
export type {
  TransformResult,
  TransformOptions,
  WasmTypicalCompilerOptions,
  RawSourceMap,
} from "./client.js";
export { Go } from "./wasm-exec.js";
export { createSyncFS, installSyncFS } from "./sync-fs.js";
export type { SyncFS } from "./sync-fs.js";

/**
 * Path to the WASM binary.
 * Use this when you need to load the WASM file yourself.
 */
export const wasmPath = new URL("../bin/typical.wasm", import.meta.url);
