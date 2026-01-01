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
}

export const defaultConfig: TypicalConfig = {
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules/**", "**/*.d.ts", "dist/**", "build/**"],
  reusableValidators: true,
  validateCasts: false,
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