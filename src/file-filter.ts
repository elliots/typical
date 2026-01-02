import * as path from 'path';
import { minimatch } from 'minimatch';
import type { TypicalConfig } from './config.js';

/**
 * Determines if a file should be transformed based on include/exclude patterns
 */
export function shouldTransformFile(fileName: string, config: TypicalConfig): boolean {
  const relativePath = path.relative(process.cwd(), fileName);

  // Exclude files outside the project directory (e.g., resolved symlinks to parent dirs)
  if (relativePath.startsWith('..')) {
    return false;
  }

  // Check include patterns
  const isIncluded = config.include?.some(pattern => {
    return minimatch(relativePath, pattern);
  }) ?? true;

  if (!isIncluded) return false;

  // Check exclude patterns
  const isExcluded = config.exclude?.some(pattern => {
    return minimatch(relativePath, pattern);
  }) ?? false;

  return !isExcluded;
}

/**
 * Checks if a file is a TypeScript file that can be transformed
 */
export function isTransformableTypeScriptFile(fileName: string): boolean {
  // Only transform TypeScript files
  if (!/\.(ts|tsx)$/.test(fileName)) return false;
  
  // Skip declaration files
  if (fileName.endsWith('.d.ts')) return false;
  
  return true;
}

/**
 * Combined check for both file type and include/exclude patterns
 */
export function shouldIncludeFile(fileName: string, config: TypicalConfig): boolean {
  return isTransformableTypeScriptFile(fileName) && shouldTransformFile(fileName, config);
}