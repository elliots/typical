/**
 * Metro custom transformer for Typical.
 *
 * This module is loaded by Metro via the babelTransformerPath config option.
 * It transforms TypeScript source code to inject Typical runtime validators,
 * then delegates to the upstream Metro babel transformer for AST generation.
 *
 * Metro expects:
 *   exports.transform = async ({ src, filename, options }) => { ast }
 *   exports.getCacheKey = () => string
 */

import { loadConfig, type TypicalConfig, buildTimer } from "@elliots/typical";
import { resolveOptions, type Options } from "./core/options";
import { transformFile } from "./core/transform";
import { resolveUpstreamTransformer } from "./core/upstream";
import { createHash } from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// File extensions to transform
const TS_FILTER = /\.(ts|tsx|mts|cts)$/;

// Module-level state: configured once when the module is first loaded.
// Metro loads transformer modules once and reuses them across all transforms.
let resolvedConfig: TypicalConfig | null = null;
let resolvedOpts: ReturnType<typeof resolveOptions> | null = null;

/**
 * Configure the Typical Metro transformer.
 *
 * Call this before Metro starts processing files to set custom options.
 * If not called, defaults are used (typical.json + auto-detect upstream).
 */
export function configure(rawOptions: Options = {}): void {
  resolvedOpts = resolveOptions(rawOptions);
  resolvedConfig = {
    ...loadConfig(),
    ...resolvedOpts.typical,
  };
}

/**
 * Ensure configuration is initialised (lazy default).
 */
function ensureConfigured(): {
  config: TypicalConfig;
  opts: ReturnType<typeof resolveOptions>;
} {
  if (!resolvedConfig || !resolvedOpts) {
    configure();
  }
  return { config: resolvedConfig!, opts: resolvedOpts! };
}

/**
 * Metro transform function.
 *
 * Receives source code and filename, returns a Babel AST.
 * If the file is TypeScript, Typical transforms it first,
 * then passes the result to the upstream transformer.
 */
export async function transform(params: {
  src: string;
  filename: string;
  options: Record<string, unknown>;
}): Promise<{ ast: object }> {
  const { src, filename, options } = params;
  const { config, opts } = ensureConfigured();
  const upstream = resolveUpstreamTransformer(opts.upstreamTransformer);

  // Only transform TypeScript files
  if (!TS_FILTER.test(filename)) {
    return upstream.transform({ src, filename, options });
  }

  // Check exclude patterns
  if (
    opts.exclude.some((pattern) =>
      typeof pattern === "string" ? filename.includes(pattern) : pattern.test(filename),
    )
  ) {
    return upstream.transform({ src, filename, options });
  }

  // Check include patterns if specified
  if (
    opts.include.length > 0 &&
    !opts.include.some((pattern) =>
      typeof pattern === "string" ? filename.includes(pattern) : pattern.test(filename),
    )
  ) {
    return upstream.transform({ src, filename, options });
  }

  // Transform with Typical
  const result = await transformFile(filename, config);

  if (process.env.DEBUG) {
    buildTimer.report("[metro-transformer-typical]");
  }

  // If Typical didn't transform (unsupported extension, etc.), pass through
  const transformedSrc = result ? result.code : src;

  // Pass to upstream transformer for Babel AST generation
  return upstream.transform({
    src: transformedSrc,
    filename,
    options,
  });
}

/**
 * Cache key for Metro's transform cache.
 *
 * Metro uses this to invalidate cached transforms when the transformer changes.
 * We include the package version, config hash, and upstream cache key.
 */
export function getCacheKey(): string {
  const { opts } = ensureConfigured();
  const upstream = resolveUpstreamTransformer(opts.upstreamTransformer);

  const hash = createHash("sha256");

  // Include our own version for cache busting on package updates
  try {
    const pkgJson = require("@elliots/metro-transformer-typical/package.json");
    hash.update(`typical-metro:${pkgJson.version}`);
  } catch {
    hash.update("typical-metro:unknown");
  }

  // Include Typical config in cache key
  const { config } = ensureConfigured();
  hash.update(JSON.stringify(config));

  // Include upstream cache key
  if (upstream.getCacheKey) {
    hash.update(upstream.getCacheKey());
  }

  return hash.digest("hex");
}
