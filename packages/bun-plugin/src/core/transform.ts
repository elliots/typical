import { resolve, extname } from "path";
import type { TypicalConfig } from "@elliots/typical";
import { TypicalTransformer, validateConfig, buildTimer } from "@elliots/typical";

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

// Map file extensions to Bun loader types
const LOADER_MAP: Record<string, "ts" | "tsx"> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

export interface TransformResult {
  code: string;
  loader: "ts" | "tsx";
}

// Shared transformer instance (Go compiler keeps project loaded)
let sharedTransformer: TypicalTransformer | null = null;

/**
 * Transform a TypeScript file with Typical.
 *
 * Returns TypeScript code with validation injected.
 * Bun handles the final transpilation to JavaScript.
 */
export async function transformFile(
  filePath: string,
  config: TypicalConfig,
): Promise<TransformResult | undefined> {
  buildTimer.start("total-transform");

  // Only transform TypeScript files
  const ext = extname(filePath).toLowerCase();
  if (!TRANSFORM_EXTENSIONS.has(ext)) {
    buildTimer.end("total-transform");
    return undefined;
  }

  const resolvedPath = resolve(filePath);

  // Lazy init shared transformer (Go compiler stays running)
  buildTimer.start("create-transformer");
  if (!sharedTransformer) {
    const validatedConfig = validateConfig(config);
    sharedTransformer = new TypicalTransformer(validatedConfig);
  }
  buildTimer.end("create-transformer");

  // Transform the file - returns TypeScript with validators injected
  buildTimer.start("transform");
  const result = await sharedTransformer.transform(resolvedPath, "ts");
  buildTimer.end("transform");

  buildTimer.end("total-transform");

  if (process.env.DEBUG) {
    console.log(`[bun-plugin-typical] Transformed: ${filePath}`);
  }

  return {
    code: result.code,
    loader: LOADER_MAP[ext] ?? "ts",
  };
}

/**
 * Close the shared transformer and release resources.
 */
export async function closeTransformer(): Promise<void> {
  if (sharedTransformer) {
    await sharedTransformer.close();
    sharedTransformer = null;
  }
}
