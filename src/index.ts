export { TypicalTransformer, TransformResult } from './transformer.js';
export { loadConfig, validateConfig, defaultConfig, TypicalConfig, TypicalSourceMapConfig } from './config.js';
export {
  composeSourceMaps,
  inlineSourceMapComment,
  externalSourceMapComment,
  createIdentityMap,
  stripSourceMapComment,
} from './source-map.js';
export type { SourceMapOptions } from './source-map.js';