export interface TypicalDebugConfig {
  writeIntermediateFiles?: boolean;
}

export interface TypicalConfig {
  include?: string[];
  exclude?: string[];
  reusableValidators?: boolean;
  validateCasts?: boolean;
  hoistRegex?: boolean;
  debug?: TypicalDebugConfig;
  /**
   * Type patterns to skip validation for (supports wildcards).
   * Use this for types that typia cannot process (e.g., React event types).
   * Example: ["React.*", "Express.Request", "*.Event"]
   */
  ignoreTypes?: string[];
  /**
   * Skip validation for DOM types (Document, Element, Node, etc.) and their subclasses.
   * These types have complex Window intersections that typia cannot process.
   * Default: true
   */
  ignoreDOMTypes?: boolean;
  /**
   * Validate function parameters and return types at runtime.
   * When enabled, typed function parameters get runtime validation calls injected.
   * Default: true
   */
  validateFunctions?: boolean;
}

/**
 * Pre-compiled regex patterns for ignore type matching.
 * This is populated during config loading for performance.
 */
export interface CompiledIgnorePatterns {
  /** Compiled patterns from user ignoreTypes config */
  userPatterns: RegExp[];
  /** Compiled patterns from DOM_TYPES_TO_IGNORE (when ignoreDOMTypes is true) */
  domPatterns: RegExp[];
  /** All patterns combined for quick checking */
  allPatterns: RegExp[];
}

export const defaultConfig: TypicalConfig = {
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules/**", "**/*.d.ts", "dist/**", "build/**"],
  reusableValidators: true,
  validateCasts: false,
  validateFunctions: true,
  hoistRegex: true,
  ignoreDOMTypes: true,
  debug: {
    writeIntermediateFiles: false,
  },
};

// FIXME: find a better way to work out which types to ignore
/**
 * DOM types that typia cannot process due to Window global intersections.
 * These are the base DOM types - classes extending them are checked separately.
 */
export const DOM_TYPES_TO_IGNORE = [
  // Core DOM types
  "Document",
  "DocumentFragment",
  "Element",
  "Node",
  "ShadowRoot",
  "Window",
  "EventTarget",
  // HTML Elements
  "HTML*Element",
  "HTMLElement",
  "HTMLCollection",
  // SVG Elements
  "SVG*Element",
  "SVGElement",
  // Events
  "*Event",
  // Other common DOM types
  "NodeList",
  "DOMTokenList",
  "NamedNodeMap",
  "CSSStyleDeclaration",
  "Selection",
  "Range",
  "Text",
  "Comment",
  "CDATASection",
  "ProcessingInstruction",
  "DocumentType",
  "Attr",
  "Table",
  "TableRow",
  "TableCell",
  "StyleSheet",
];

import fs from 'fs';
import path from 'path';

/**
 * Convert a glob pattern to a RegExp for type matching.
 * Supports wildcards: "React.*" -> /^React\..*$/
 */
export function compileIgnorePattern(pattern: string): RegExp | null {
  try {
    const regexStr = '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except *
      .replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr);
  } catch (error) {
    console.warn(`TYPICAL: Invalid ignoreTypes pattern "${pattern}": ${error}`);
    return null;
  }
}

/**
 * Pre-compile all ignore patterns for efficient matching.
 */
export function compileIgnorePatterns(config: TypicalConfig): CompiledIgnorePatterns {
  const userPatterns: RegExp[] = [];
  const domPatterns: RegExp[] = [];

  // Compile user patterns
  for (const pattern of config.ignoreTypes ?? []) {
    const compiled = compileIgnorePattern(pattern);
    if (compiled) {
      userPatterns.push(compiled);
    }
  }

  // Compile DOM patterns if enabled (default: true)
  if (config.ignoreDOMTypes !== false) {
    for (const pattern of DOM_TYPES_TO_IGNORE) {
      const compiled = compileIgnorePattern(pattern);
      if (compiled) {
        domPatterns.push(compiled);
      }
    }
  }

  return {
    userPatterns,
    domPatterns,
    allPatterns: [...userPatterns, ...domPatterns],
  };
}

// Cache for compiled patterns, keyed by config identity
let cachedPatterns: CompiledIgnorePatterns | null = null;
let cachedConfig: TypicalConfig | null = null;

/**
 * Get compiled ignore patterns, using cache if config hasn't changed.
 */
export function getCompiledIgnorePatterns(config: TypicalConfig): CompiledIgnorePatterns {
  // Simple identity check - if same config object, use cache
  if (cachedConfig === config && cachedPatterns) {
    return cachedPatterns;
  }

  cachedConfig = config;
  cachedPatterns = compileIgnorePatterns(config);
  return cachedPatterns;
}

export function loadConfig(configPath?: string): TypicalConfig {
  const configFile = configPath || path.join(process.cwd(), 'typical.json');
  
  if (fs.existsSync(configFile)) {
    try {
      const configContent = fs.readFileSync(configFile, 'utf8');
      const userConfig: Partial<TypicalConfig> = JSON.parse(configContent);
      
      return {
        ...defaultConfig,
        ...userConfig,
      };
    } catch (error) {
      console.warn(`Failed to parse config file ${configFile}:`, error);
      return defaultConfig;
    }
  }

  return defaultConfig;
}