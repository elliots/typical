import { resolve, extname } from "path";
import type { TypicalConfig } from "@elliots/typical";
import { TypicalTransformer, validateConfig, buildTimer } from "@elliots/typical";

// Extensions that we should transform
const TRANSFORM_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

// Errors that indicate a file should be skipped (not transformed)
const SKIP_ERROR_PATTERNS = [
  "source file not found", // File is outside the TypeScript project
];

export interface TransformResult {
  code: string;
}

// Shared transformer instance (Go compiler keeps project loaded)
let sharedTransformer: TypicalTransformer | null = null;

/**
 * Transform a TypeScript file with Typical.
 *
 * Returns TypeScript source with validation injected.
 * The upstream Metro babel transformer handles transpilation to JS and AST generation.
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
  let result;
  try {
    result = await sharedTransformer.transform(resolvedPath, "ts");
  } catch (error) {
    buildTimer.end("transform");
    buildTimer.end("total-transform");

    // Check if this is an error we should skip (e.g., file outside project)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const shouldSkip = SKIP_ERROR_PATTERNS.some((pattern) => errorMessage.includes(pattern));

    if (shouldSkip) {
      if (process.env.DEBUG) {
        console.log(`[metro-transformer-typical] Skipping file (not in project): ${resolvedPath}`);
      }
      return undefined;
    }

    // Re-throw other errors
    throw error;
  }
  buildTimer.end("transform");

  buildTimer.end("total-transform");

  if (process.env.DEBUG) {
    console.log(`[metro-transformer-typical] Transformed: ${filePath}`);
  }

  return {
    code: result.code,
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
