/**
 * This entry file is for Rollup plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Rollup plugin
 *
 * @example
 * ```ts
 * // rollup.config.js
 * import Typical from '@elliots/unplugin-typical/rollup'
 *
 * export default {
 *   plugins: [Typical()],
 * }
 * ```
 */
const rollup = Typical.rollup as typeof Typical.rollup
export default rollup
export { rollup as 'module.exports' }
