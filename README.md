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
| `debug.writeIntermediateFiles` | `false` | Write `.typical.ts` files showing code before typia transform |

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

## Flow Analysis

Typical includes smart flow analysis to avoid redundant validations. When you return a value that was already validated (either as a parameter or via a type-annotated const), the return statement won't be wrapped in another validation call.

### When return validation is skipped:

```typescript
interface User { name: string; }

// Direct parameter return - no redundant validation
function validate(user: User): User {
  return user;  // Already validated on entry, skip return validation
}

// Property access from validated parameter
function getAddress(user: User): Address {
  return user.address;  // user was validated, address is safe
}

// Type-annotated const
function getUser(): User {
  const user: User = fetchData();  // const is validated here
  return user;  // skip redundant validation
}
```

### When return validation IS applied (tainting):

```typescript
// After mutation
function updateUser(user: User): User {
  user.name = "modified";  // Mutation taints the value
  return user;  // Must re-validate
}

// After passing to another function
function processUser(user: User): User {
  someFunction(user);  // Could have mutated user
  return user;  // Must re-validate
}

// After await (async boundary)
async function asyncProcess(user: User): Promise<User> {
  await delay();  // Async boundary taints values
  return user;  // Must re-validate
}

// Spread into new object
function cloneUser(user: User): User {
  return { ...user };  // New object, must validate
}
```

## Debugging

### Intermediate Files

To see what code Typical generates before typia processes it, enable intermediate file output:

```json
{
  "debug": {
    "writeIntermediateFiles": true
  }
}
```

This creates `.typical.ts` files alongside your output showing the code with typia calls injected but not yet transformed.

### Verbose Logging

Set `DEBUG=1` environment variable for detailed logging:

```bash
DEBUG=1 npm run build
```

## Troubleshooting

### "Failed to transform the following types"

This error means typia couldn't generate validation code for certain types. Common causes:

1. **DOM types**: Types like `HTMLElement`, `Document`, etc. have complex intersections typia can't process.
   - Solution: Enable `ignoreDOMTypes: true` (default) or add specific types to `ignoreTypes`

2. **React types**: Event handlers, refs, and other React types often can't be validated.
   - Solution: Add `"React.*"` to `ignoreTypes`

3. **Third-party library types**: Some library types are too complex.
   - Solution: Add the specific type patterns to `ignoreTypes`

```json
{
  "ignoreTypes": ["React.*", "Express.Request", "Prisma.*"]
}
```

### "Window & typeof globalThis" errors

This occurs when a type includes DOM globals. Enable `ignoreDOMTypes: true` or add the specific type to `ignoreTypes`.

### Generic type parameters not validated

Type parameters (`T`, `U`, etc.) cannot be validated at runtime because the actual type isn't known until the function is called. This is by design:

```typescript
function identity<T>(value: T): T {
  return value;  // T is not validated - no runtime type info
}
```

Concrete types in the same function ARE validated:

```typescript
function process<T>(value: T, user: User): User {
  return user;  // User IS validated
}
```

### Constructor parameters not validated

Currently, class constructors are not transformed. This is a known limitation. Validate in the constructor body if needed:

```typescript
class Client {
  constructor(options: Options) {
    // Manual validation if needed
    if (!options.timeout) throw new Error("timeout required");
  }
}
```

## Credits
The actual validation work is done by [typia](https://github.com/samchon/typia). This package just generates the necessary code to call typia's functions based on your TypeScript types.

> NOTE: The whole package was all mostly LLM. Feel free to improve it without care for the author's feelings. 

