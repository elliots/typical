/**
 * This entry file is for Rolldown plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Rolldown plugin
 *
 * @example
 * ```ts
 * // rolldown.config.js
 * import Typical from '@elliots/unplugin-typical/rolldown'
 *
 * export default {
 *   plugins: [Typical()],
 * }
 * ```
 */
const rolldown = Typical.rolldown as typeof Typical.rolldown
export default rolldown
export { rolldown as 'module.exports' }
