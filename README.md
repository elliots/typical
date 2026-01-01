# Typical

Typical adds runtime validation to typescript, making TypeScript type-safe at runtime *with no changes to your code*. 

It can be used as a TSC plugin, ESM loader for Node.js, or with bundlers like Vite, Webpack, and Rollup via unplugin.

## Why?

For some use cases it can mean you don't need to use zod, yup, ajv, or other runtime validation libraries, as your types are already validated automatically.

It protects you from leaking data via JSON.stringify by making sure only the properties defined in your types are included in the output.

Why not.

## Features

- ✅ Automatic validation of function parameters
- ✅ Automatic validation of return types
- ✅ Replace `JSON.stringify` with a custom stringifier (very fast!)
- ✅ Replace `JSON.parse` with a custom parser and validator (very fast!)
- ✅ Configurable include/exclude patterns
- ✅ Optionally reuse validation logic for identical types to optimize performance (enabled by default)
- ✅ TSC plugin
- ✅ ESM loader for runtime transformation with `node --import @elliots/typical/esm` (or `node --loader @elliots/typical/esm-loader` for older Node versions)
- ✅ tsx wrapper (ttsx) for easy use like `npx ttsx script.ts`
- ✅ Unplugin for Vite, Webpack, Rollup, esbuild, and more

## Installation

```bash
npm add typical
```

## Configuration

Optional: Create a `typical.json` file in your project root.

If not provided, these default settings will be used.

```json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules/**", "**/*.d.ts", "dist/**", "build/**"],
  "reusableValidators": true,
  "validateFunctions": true,
  "validateCasts": false,
  "hoistRegex": true,
  "ignoreDOMTypes": true,
  "ignoreTypes": []
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `include` | `["**/*.ts", "**/*.tsx"]` | Glob patterns for files to transform |
| `exclude` | `["node_modules/**", "**/*.d.ts", "dist/**", "build/**"]` | Glob patterns for files to skip |
| `reusableValidators` | `true` | Create shared validators for identical types (smaller output, allows reuse) |
| `validateFunctions` | `true` | Validate function parameters and return types at runtime |
| `validateCasts` | `false` | Validate type assertions (`as Type`) at runtime |
| `hoistRegex` | `true` | Hoist regex patterns to top-level constants (improves performance) |
| `ignoreDOMTypes` | `true` | Skip validation for DOM types (Document, Element, etc.) |
| `ignoreTypes` | `[]` | Type patterns to skip validation for (supports wildcards, e.g., `["React.*"]`) |

## Usage

See ./samples/esm and ./samples/tsc and ./samples/ttsx

Quickest way to try it out is to use ttsx:

```bash
npm add @elliots/typical
npx ttsx your-script.ts
```

or globally:

```bash
npm add -g @elliots/typical
ttsx your-script.ts
```

## Vite / Webpack / Rollup (unplugin)

Install the unplugin:

```bash
npm add @elliots/unplugin-typical
```

### Vite

```typescript
// vite.config.ts
import Typical from '@elliots/unplugin-typical/vite'

export default defineConfig({
  plugins: [
    Typical(),
  ],
})
```

### Webpack

```typescript
// webpack.config.js
const Typical = require('@elliots/unplugin-typical/webpack').default

module.exports = {
  plugins: [
    Typical(),
  ],
}
```

### Rollup

```typescript
// rollup.config.js
import Typical from '@elliots/unplugin-typical/rollup'

export default {
  plugins: [
    Typical(),
  ],
}
```

### esbuild

```typescript
import { build } from 'esbuild'
import Typical from '@elliots/unplugin-typical/esbuild'

build({
  plugins: [Typical()],
})
```

### Plugin Configuration

Pass options directly to the plugin:

```typescript
Typical({
  validateFunctions: true,
  validateCasts: false,
  // ... other options
})
```

Or use a `typical.json` file in your project root (shared with other entry points like TSC plugin and ESM loader).

## Example

This code will run without errors when compiled normally, but will throw an error when using Typical.


```ts
interface User {
  name: string;
  email: `${string}@${string}`;
} 
const u = JSON.parse('{"name":"Alice","email":"oops-not-an-email"}') as User;
```

## How it works

Typical uses the TypeScript Compiler API to parse and transform your TypeScript code. It analyzes function signatures, return types, and JSON operations to inject appropriate typia validation calls.

But basically you shouldn't need to care about how it works internally, it makes typescript strongly typed*. You can still use `any` and `unknown` if you want to opt out of type safety.

* sort of. probably. something like it anyway.

## Credits
The actual validation work is done by [typia](https://github.com/samchon/typia). This package just generates the necessary code to call typia's functions based on your TypeScript types.

> NOTE: The whole package was all mostly LLM. Feel free to improve it without care for the author's feelings. 

