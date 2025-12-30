import { fileURLToPath, pathToFileURL } from "url";
import { existsSync } from "fs";
import { TypicalTransformer } from "./transformer.js";

const transformer = new TypicalTransformer();

/**
 * Resolve hook - rewrites .js imports to .ts if the .ts file exists
 */
export async function resolve(specifier: string, context: any, nextResolve: any) {
  // Only handle relative imports ending in .js
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    const { parentURL } = context;
    if (parentURL) {
      const parentPath = fileURLToPath(parentURL);
      const dir = parentPath.substring(0, parentPath.lastIndexOf('/'));
      const tsPath = dir + '/' + specifier.slice(0, -3) + '.ts';

      if (existsSync(tsPath)) {
        return {
          url: pathToFileURL(tsPath).href,
          shortCircuit: true,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}

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
