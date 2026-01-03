export interface ProjectHandle {
  id: string
  configFile: string
  rootFiles: string[]
}

export interface RawSourceMap {
  version: number
  file: string
  sourceRoot?: string
  sources: string[]
  names: string[]
  mappings: string
  sourcesContent?: (string | null)[]
}

export interface TransformResult {
  code: string
  sourceMap?: RawSourceMap
}
