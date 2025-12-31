/**
 * This entry file is for Vite plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Vite plugin
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import Typical from '@elliots/unplugin-typical/vite'
 *
 * export default defineConfig({
 *   plugins: [Typical()],
 * })
 * ```
 */
const vite = Typical.vite as typeof Typical.vite
export default vite
export { vite as 'module.exports' }
