export interface ProjectHandle {
  id: string;
  configFile: string;
  rootFiles: string[];
}

export interface RawSourceMap {
  version: number;
  file: string;
  sourceRoot?: string;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
}

export interface TransformResult {
  code: string;
  sourceMap?: RawSourceMap;
}

/** Represents a single validation point in the source code */
export interface ValidationItem {
  /** 1-based line number */
  startLine: number;
  /** 0-based column */
  startColumn: number;
  /** 1-based line number */
  endLine: number;
  /** 0-based column */
  endColumn: number;
  /** Type of validation: "parameter", "return", "cast", "json-parse", "json-stringify" */
  kind: "parameter" | "return" | "cast" | "json-parse" | "json-stringify";
  /** Name of the item being validated (param name, "return value", or expression text) */
  name: string;
  /** Whether the item will be validated or skipped */
  status: "validated" | "skipped";
  /** Human-readable type string */
  typeString: string;
  /** Reason for skipping (when status is "skipped") */
  skipReason?: string;
}

export interface AnalyseResult {
  items: ValidationItem[];
}
