/**
 * Resolve the upstream Metro Babel transformer.
 *
 * Detection order:
 * 1. User-specified path (options.upstreamTransformer)
 * 2. @expo/metro-config/babel-transformer (Expo projects)
 * 3. metro-react-native-babel-transformer (vanilla React Native)
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);

export interface UpstreamTransformer {
  transform(params: {
    src: string;
    filename: string;
    options: Record<string, unknown>;
  }): Promise<{ ast: object }>;
  getCacheKey?: () => string;
}

function tryRequire(modulePath: string): UpstreamTransformer | undefined {
  try {
    return require(modulePath);
  } catch {
    return undefined;
  }
}

let cachedUpstream: UpstreamTransformer | undefined;

/**
 * Resolve and cache the upstream transformer.
 */
export function resolveUpstreamTransformer(customPath?: string): UpstreamTransformer {
  if (cachedUpstream) {
    return cachedUpstream;
  }

  if (customPath) {
    const upstream = tryRequire(customPath);
    if (!upstream) {
      throw new Error(
        `[metro-transformer-typical] Could not load upstream transformer: ${customPath}`,
      );
    }
    cachedUpstream = upstream;
    return upstream;
  }

  // Try Expo first (more specific)
  const expo = tryRequire("@expo/metro-config/babel-transformer");
  if (expo) {
    if (process.env.DEBUG) {
      console.log("[metro-transformer-typical] Using Expo babel transformer");
    }
    cachedUpstream = expo;
    return expo;
  }

  // Fall back to standard React Native
  const rn = tryRequire("metro-react-native-babel-transformer");
  if (rn) {
    if (process.env.DEBUG) {
      console.log("[metro-transformer-typical] Using metro-react-native-babel-transformer");
    }
    cachedUpstream = rn;
    return rn;
  }

  throw new Error(
    "[metro-transformer-typical] Could not find an upstream Metro transformer. " +
      "Install either @expo/metro-config (for Expo) or " +
      "metro-react-native-babel-transformer (for React Native), " +
      "or specify a custom path via the upstreamTransformer option.",
  );
}
