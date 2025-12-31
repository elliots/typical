/**
 * This entry file is for Farm plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Farm plugin
 *
 * @example
 * ```ts
 * // farm.config.ts
 * import Typical from '@elliots/unplugin-typical/farm'
 *
 * export default {
 *   plugins: [Typical()],
 * }
 * ```
 */
const farm = Typical.farm as typeof Typical.farm
export default farm
export { farm as 'module.exports' }
