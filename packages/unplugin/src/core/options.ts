import type { TypicalConfig } from "@elliots/typical";

export interface Options {
  /**
   * Patterns to include for transformation.
   * Uses unplugin's filter format.
   */
  include?: (string | RegExp)[];

  /**
   * Patterns to exclude from transformation.
   * Uses unplugin's filter format.
   */
  exclude?: (string | RegExp)[];

  /**
   * Plugin enforcement order.
   * @default undefined
   */
  enforce?: "pre" | "post";

  /**
   * Typical configuration overrides.
   */
  typical?: Partial<TypicalConfig>;
}

export interface ResolvedOptions {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  enforce?: "pre" | "post";
  typical: Partial<TypicalConfig>;
}

/**
 * Resolve plugin options with defaults.
 */
export function resolveOptions(options: Options = {}): ResolvedOptions {
  return {
    include: options.include ?? [/\.[cm]?tsx?$/],
    exclude: options.exclude ?? [/node_modules/],
    enforce: options.enforce,
    typical: options.typical ?? {},
  };
}
