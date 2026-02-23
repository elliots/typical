import type { TypicalConfig } from "@elliots/typical";

export interface Options {
  /**
   * Patterns to include for transformation.
   * If empty, all TypeScript files are included.
   */
  include?: (string | RegExp)[];

  /**
   * Patterns to exclude from transformation.
   */
  exclude?: (string | RegExp)[];

  /**
   * Path to the upstream Metro babel transformer.
   * If not provided, auto-detects Expo or standard React Native transformer.
   *
   * @default undefined (auto-detect)
   */
  upstreamTransformer?: string;

  /**
   * Typical configuration overrides.
   * Merged on top of typical.json settings.
   */
  typical?: Partial<TypicalConfig>;
}

export interface ResolvedOptions {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  upstreamTransformer?: string;
  typical: Partial<TypicalConfig>;
}

/**
 * Resolve plugin options with defaults.
 */
export function resolveOptions(options: Options = {}): ResolvedOptions {
  return {
    include: options.include ?? [],
    exclude: options.exclude ?? [/node_modules/],
    upstreamTransformer: options.upstreamTransformer,
    typical: options.typical ?? {},
  };
}
