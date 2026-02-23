/**
 * @elliots/metro-transformer-typical
 *
 * Metro bundler transformer for Typical - adds runtime validation
 * to TypeScript code in React Native / Expo projects.
 *
 * @example
 * ```js
 * // metro.config.js
 * const { getDefaultConfig } = require("expo/metro-config");
 * const { withTypical } = require("@elliots/metro-transformer-typical");
 *
 * module.exports = withTypical(getDefaultConfig(__dirname));
 * ```
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Options } from "./core/options";
import { configure } from "./transformer";

export type { Options } from "./core/options";
export { resolveOptions } from "./core/options";
export { closeTransformer } from "./core/transform";
export { configure } from "./transformer";

/**
 * Metro configuration type (subset — avoids requiring metro as a dependency).
 */
interface MetroConfig {
  transformer?: {
    babelTransformerPath?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Wrap a Metro configuration to use Typical's transformer.
 *
 * Sets the babelTransformerPath and pre-configures Typical options.
 * Compatible with both Expo's getDefaultConfig() and bare React Native.
 *
 * @example Expo project
 * ```js
 * const { getDefaultConfig } = require("expo/metro-config");
 * const { withTypical } = require("@elliots/metro-transformer-typical");
 *
 * module.exports = withTypical(getDefaultConfig(__dirname));
 * ```
 *
 * @example Vanilla React Native
 * ```js
 * const { getDefaultConfig } = require("@react-native/metro-config");
 * const { withTypical } = require("@elliots/metro-transformer-typical");
 *
 * module.exports = withTypical(getDefaultConfig(__dirname));
 * ```
 *
 * @example With options
 * ```js
 * module.exports = withTypical(getDefaultConfig(__dirname), {
 *   typical: {
 *     validateCasts: true,
 *   },
 * });
 * ```
 */
export function withTypical<T extends MetroConfig>(config: T, options?: Options): T {
  // Pre-configure the transformer module with our options
  configure(options);

  return {
    ...config,
    transformer: {
      ...config.transformer,
      babelTransformerPath: join(dirname(fileURLToPath(import.meta.url)), "transformer.cjs"),
    },
  };
}
