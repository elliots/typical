/**
 * This entry file is for Rspack plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Rspack plugin
 *
 * @example
 * ```js
 * // rspack.config.js
 * import Typical from '@elliots/unplugin-typical/rspack'
 *
 * export default {
 *   plugins: [Typical()],
 * }
 * ```
 */
const rspack = Typical.rspack as typeof Typical.rspack
export default rspack
export { rspack as 'module.exports' }
