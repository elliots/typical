import { fileURLToPath } from "url";
import { TypicalTransformer } from "./transformer.js";

// Initialize transformer and load TypeScript project

const transformer = new TypicalTransformer();

console.log("Typical ESM loader initialized with TypeScript project");

/**
 * Resolve hook - determines if we should handle this module
 */
export async function resolve(
  specifier: string,
  context: any,
  nextResolve: any
) {
  const result = await nextResolve(specifier, context);

  // Only process TypeScript files that should be included
  if (result.url && result.url.startsWith("file://")) {
    const filePath = fileURLToPath(result.url);
    if (transformer.shouldTransformFile(filePath)) {
      // Mark this as a TypeScript file for our load hook
      result.format = "typescript";
    }
  }

  return result;
}

/**
 * Load hook - transforms TypeScript files on the fly
 */
export async function load(url: string, context: any, nextLoad: any) {
  const filePath = fileURLToPath(url);

  if (context.format !== "typescript") {
    return nextLoad(url, context);
  }

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

// /**
//  * Global preload hook - runs once when the loader starts
//  */
// export function globalPreload() {
//   return `
//     console.log('Typical ESM loader preloaded');
//   `;
// }
