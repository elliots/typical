import { fileURLToPath } from "url";
import { TypicalTransformer } from "./transformer.js";

const transformer = new TypicalTransformer();

/**
 * Load hook - transforms TypeScript files on the fly
 */
export async function load(url: string, context: any, nextLoad: any) {
  if (!url.endsWith(".ts")) {
    return nextLoad(url, context);
  }
  const filePath = fileURLToPath(url);

  try {
    const transformedCode = transformer.transform(filePath, 'js');
    return {
      format: "module",
      source: transformedCode,
      shortCircuit: true,
    };
  } catch (error) {
    console.error(`Error transforming ${filePath}:`, error);
    throw error;
  }
}
