import type { TypicalConfig } from "@elliots/typical";

export interface Options {
  /**
   * Bun plugin target.
   * @default 'bun'
   */
  target?: "bun" | "browser" | "node";

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
   * Typical configuration overrides.
   */
  typical?: Partial<TypicalConfig>;
}

export interface ResolvedOptions {
  target: "bun" | "browser" | "node";
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  typical: Partial<TypicalConfig>;
}

/**
 * Resolve plugin options with defaults.
 */
export function resolveOptions(options: Options = {}): ResolvedOptions {
  return {
    target: options.target ?? "bun",
    include: options.include ?? [],
    exclude: options.exclude ?? [/node_modules/],
    typical: options.typical ?? {},
  };
}
