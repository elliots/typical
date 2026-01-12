import type { BunPlugin } from "bun";
import { loadConfig, type TypicalConfig, buildTimer } from "@elliots/typical";
import { resolveOptions, type Options } from "./core/options";
import { transformFile } from "./core/transform";

// File extensions to transform
const TS_FILTER = /\.(ts|tsx|mts|cts)$/;

/**
 * Create a Bun plugin for Typical transformation.
 *
 * @example
 * ```ts
 * // For Bun.build()
 * import typicalPlugin from '@elliots/bun-plugin-typical'
 *
 * await Bun.build({
 *   entrypoints: ['./src/index.ts'],
 *   outdir: './dist',
 *   plugins: [typicalPlugin()],
 * })
 * ```
 *
 * @example
 * ```ts
 * // For runtime (bunfig.toml preload)
 * import typicalPlugin from '@elliots/bun-plugin-typical'
 *
 * Bun.plugin(typicalPlugin())
 * ```
 */
export function typicalPlugin(rawOptions: Options = {}): BunPlugin {
  const options = resolveOptions(rawOptions);

  const typicalConfig: TypicalConfig = {
    ...loadConfig(),
    ...options.typical,
  };

  return {
    name: "bun-plugin-typical",
    target: options.target,

    setup(build) {
      // Reset timing state for fresh builds
      buildTimer.reset();

      build.onLoad({ filter: TS_FILTER }, async (args) => {
        // Skip excluded paths
        if (
          options.exclude.some((pattern) =>
            typeof pattern === "string" ? args.path.includes(pattern) : pattern.test(args.path),
          )
        ) {
          return undefined;
        }

        // Check include patterns if specified
        if (
          options.include.length > 0 &&
          !options.include.some((pattern) =>
            typeof pattern === "string" ? args.path.includes(pattern) : pattern.test(args.path),
          )
        ) {
          return undefined;
        }

        const result = await transformFile(args.path, typicalConfig);

        if (!result) {
          return undefined;
        }

        // Debug logging
        if (process.env.DEBUG) {
          buildTimer.report("[bun-plugin-typical]");
        }

        return {
          contents: result.code,
          loader: result.loader,
        };
      });
    },
  };
}

// Default export for convenience
export default typicalPlugin;

// Named exports
export type { Options } from "./core/options";
export { closeTransformer } from "./core/transform";
