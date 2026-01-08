/**
 * Convenience module for preloading the Typical plugin.
 *
 * @example
 * ```toml
 * # bunfig.toml
 * preload = ["./preload.ts"]
 * ```
 *
 * @example
 * ```ts
 * // preload.ts
 * import '@elliots/bun-plugin-typical/preload'
 * ```
 *
 * Or with custom options:
 * ```ts
 * // preload.ts
 * import { typicalPlugin } from '@elliots/bun-plugin-typical'
 *
 * Bun.plugin(typicalPlugin({
 *   typical: {
 *     validateCasts: true,
 *   }
 * }))
 * ```
 */
import { typicalPlugin } from './index'

// Register with default options
void Bun.plugin(typicalPlugin())
