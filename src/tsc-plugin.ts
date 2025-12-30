import type ts from 'typescript';
import type { TransformerExtras, PluginConfig } from 'ts-patch';
import { TypicalTransformer } from './transformer.js';
import { loadConfig } from './config.js';

export default function (program: ts.Program, pluginConfig: PluginConfig, { ts: tsInstance }: TransformerExtras) {
  const config = loadConfig();
  const transformer = new TypicalTransformer(config, program, tsInstance);

  // Create the typical transformer with typia integration
  return transformer.getTransformer(true);
}