/**
 * This entry file is for webpack plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Webpack plugin
 *
 * @example
 * ```js
 * // webpack.config.js
 * import Typical from '@elliots/unplugin-typical/webpack'
 *
 * export default {
 *   plugins: [Typical()],
 * }
 * ```
 */
const webpack = Typical.webpack as typeof Typical.webpack
export default webpack
export { webpack as 'module.exports' }
