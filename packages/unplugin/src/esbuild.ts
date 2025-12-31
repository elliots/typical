/**
 * This entry file is for esbuild plugin.
 *
 * @module
 */

import { Typical } from './index'

/**
 * Esbuild plugin
 *
 * @example
 * ```ts
 * import { build } from 'esbuild'
 * import Typical from '@elliots/unplugin-typical/esbuild'
 *
 * build({ plugins: [Typical()] })
 * ```
 */
const esbuild = Typical.esbuild as typeof Typical.esbuild
export default esbuild
export { esbuild as 'module.exports' }
