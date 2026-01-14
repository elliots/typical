# Typical

Typical makes TypeScript type-safe at runtime _with no changes to your code_.

It transforms your code to inject runtime validation based on your existing type annotations. With source maps, so errors point to the right lines in your original code.

## Why?

- Less need for zod, yup, ajv, or other runtime validation libraries - your types are already validated automatically. If you can express it in TypeScript, Typical can validate it at runtime.
- Protects against data leaks via `JSON.stringify` by ensuring only properties defined in your types are included
- Catches type mismatches at runtime that TypeScript can't catch at compile time (API responses, JSON parsing, un-typed/badly-typed libraries, vibe-coding coworkers etc.)

## Features

- Validation of function parameters and return types
- Safe `JSON.parse` with type validation
- Safe `JSON.stringify` that only includes defined properties
- Validation of type casts (`as Type`)
- Configurable include/exclude patterns

## Example

This code runs without errors in normal TypeScript, but Typical catches the invalid data:

```ts
interface User {
  name: string;
  email: `${string}@${string}`;
}

// This will throw - email doesn't match the template literal type
const user = JSON.parse('{"name":"Alice","email":"not-an-email"}') as User;
```

---

## Usage Options

Choose the integration that fits your workflow:

| Method                                                    | Best For                        | Package                       |
| --------------------------------------------------------- | ------------------------------- | ----------------------------- |
| [ESM Loader](#nodejs-esm-loader)                          | Node.js scripts, development    | `@elliots/typical`            |
| [ttsx](#ttsx-tsx-wrapper)                                 | Quick scripts with tsx          | `@elliots/typical` + `tsx`    |
| [Bun Plugin](#bun)                                        | Bun projects                    | `@elliots/bun-plugin-typical` |
| [Vite/Webpack/etc](#bundlers-vite-webpack-rollup-esbuild) | Frontend apps, bundled projects | `@elliots/unplugin-typical`   |
| [tsc Plugin](#typescript-compiler-tsc)                    | Pure TypeScript compilation     | `@elliots/typical-tsc-plugin` |

---

## Node.js (ESM Loader)

The simplest way to run TypeScript with Typical validation.

```bash
npm add @elliots/typical
```

```bash
node --import @elliots/typical/esm src/index.ts
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "start": "node --import @elliots/typical/esm src/index.ts"
  }
}
```

---

## ttsx (tsx wrapper)

A convenience wrapper that combines [tsx](https://github.com/privatenumber/tsx) with Typical.

```bash
npm add @elliots/typical tsx
```

```bash
npx ttsx script.ts
```

Or install globally:

```bash
npm add -g @elliots/typical tsx
ttsx script.ts
```

> **Note:** `tsx` must be installed separately. The `ttsx` command is a thin wrapper that runs `tsx` with the Typical ESM loader.

---

## Bun

```bash
bun add @elliots/bun-plugin-typical
```

Create `bunfig.toml`:

```toml
preload = ["./preload.ts"]
```

Create `preload.ts`:

```ts
import { typicalPlugin } from "@elliots/bun-plugin-typical";

Bun.plugin(typicalPlugin());
```

Then run:

```bash
bun run src/index.ts
```

---

## Bundlers (Vite, Webpack, Rollup, esbuild)

```bash
npm add @elliots/unplugin-typical
```

### Vite

```ts
// vite.config.ts
import Typical from "@elliots/unplugin-typical/vite";

export default defineConfig({
  plugins: [Typical()],
});
```

### Webpack

```js
// webpack.config.js
const Typical = require("@elliots/unplugin-typical/webpack").default;

module.exports = {
  plugins: [Typical()],
};
```

### Rollup

```js
// rollup.config.js
import Typical from "@elliots/unplugin-typical/rollup";

export default {
  plugins: [Typical()],
};
```

### esbuild

```ts
import { build } from "esbuild";
import Typical from "@elliots/unplugin-typical/esbuild";

build({
  plugins: [Typical()],
});
```

### Rolldown

```ts
// rolldown.config.ts
import Typical from "@elliots/unplugin-typical/rolldown";

export default {
  plugins: [Typical()],
};
```

### Farm

```ts
// farm.config.ts
import Typical from "@elliots/unplugin-typical/farm";

export default {
  plugins: [Typical()],
};
```

### Rspack

```ts
// rspack.config.ts
import Typical from "@elliots/unplugin-typical/rspack";

export default {
  plugins: [Typical()],
};
```

---

## TypeScript Compiler (tsc)

For projects that compile with `tsc` directly using [ts-patch](https://github.com/nonara/ts-patch).

```bash
npm add @elliots/typical-tsc-plugin ts-patch
```

### Option 1: ttsc (auto-injects plugin)

The `ttsc` command automatically injects the plugin - no config needed:

```bash
npx ttsc
```

Add to `package.json`:

```json
{
  "scripts": {
    "build": "ttsc"
  }
}
```

### Option 2: Manual tsconfig.json

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@elliots/typical-tsc-plugin",
        "transformProgram": true
      }
    ]
  }
}
```

Then run ts-patch's tsc:

```bash
npx ts-patch install
npx tsc
```

Or add a prepare script:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s",
    "build": "tsc"
  }
}
```

---

## Configuration

Create a `typical.json` file in your project root (optional):

```json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules/**", "**/*.d.ts"],
  "validateFunctions": true,
  "validateCasts": false
}
```

### Options

| Option                   | Default                                                   | Description                                                       |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `include`                | `["**/*.ts", "**/*.tsx"]`                                 | Files to transform                                                |
| `exclude`                | `["node_modules/**", "**/*.d.ts", "dist/**", "build/**"]` | Files to skip                                                     |
| `validateFunctions`      | `true`                                                    | Validate function parameters and return types                     |
| `validateCasts`          | `false`                                                   | Validate type assertions (`as Type`)                              |
| `transformJSONParse`     | `true`                                                    | Transform `JSON.parse` to validate and filter to typed properties |
| `transformJSONStringify` | `true`                                                    | Transform `JSON.stringify` to only include typed properties       |

---

## JSON Transformations

Typical automatically transforms `JSON.parse` and `JSON.stringify` calls when type information is available.

### JSON.parse

When you cast the result of `JSON.parse`, Typical validates the parsed data and filters it to only include properties defined in your type:

```ts
interface User {
  name: string;
  age: number;
}

// Input: '{"name":"Alice","age":30,"password":"secret"}'
const user = JSON.parse(jsonString) as User;
// Result: { name: "Alice", age: 30 } - password is filtered out!
// Throws TypeError if name isn't a string or age isn't a number
```

### JSON.stringify

When you use a type assertion with `JSON.stringify`, only properties defined in your type are included - preventing accidental data leaks:

```ts
interface PublicUser {
  name: string;
  age: number;
}

const user = { name: "Alice", age: 30, password: "secret", ssn: "123-45-6789" };
const json = JSON.stringify(user as PublicUser);
// Result: '{"name":"Alice","age":30}' - sensitive data excluded!
```

Both patterns detect type information from:

- Type assertions: `JSON.parse(str) as User` or `JSON.stringify(obj as User)`
- Variable declarations: `const user: User = JSON.parse(str)`
- Function return types: `function getUser(): User { return JSON.parse(str) }`

---

## How It Works

Typical uses a Go-based compiler that leverages the TypeScript type checker to analyze your code. It generates runtime validators that check values against their declared types.

Types that can't be validated at runtime (like generic type parameters `T`) are skipped. You can still use `any` and `unknown` to opt out of validation.

## Compiler Optimisations

The generated validation code is optimised for runtime performance:

- **Reusable validators** - When the same type is validated multiple times, Typical hoists the validation logic to a reusable function at module scope. Nested types that appear in multiple places (e.g., `Address` used in both `User` and `Company`) are also extracted and reused.
- **Smart redundancy elimination** - Skips validation when returning values that are already known to be valid: validated parameters, properties of validated objects, variables assigned from casts or `JSON.parse`, and aliased variables
- **Cross-file call graph analysis** - Analyses the entire project to eliminate redundant validation across files:
  - **Trusted return values** - If a function validates its return type, callers don't re-validate the result
  - **Internal function parameters** - Non-exported functions only called with pre-validated arguments skip parameter validation
  - **Chained function calls** - When `step2(step1(user))` is called, validation flows through the chain
- **Type-aware dirty tracking** - Tracks when validated values might become invalid. Primitives stay valid after being passed to functions (they're copied), but objects are re-validated if passed to unknown functions. Pure functions (listed in the config) like `console.log` don't invalidate objects.
- **Union early bail-out** - Union type checks use if-else chains so the first matching type succeeds immediately
- **Skip comments** - Add `// @typical-ignore` before a function to skip all validation for it

## VSCode Extension

A VSCode extension is available that shows runtime validation indicators directly in your editor. It's not yet published to the marketplace, but you can build and install it locally.

### Features

- **Subtle underlines** on validated parameters, return values, type casts, and JSON operations
  - Green dotted underline = validated at runtime
  - Grey dotted underline = skipped (e.g., generic types)
- **Hover tooltips** explaining what's being validated and why
- **Optional inlay hints** showing validation status inline
- **Preview command** to see the compiled output with validation code

### Building and Installing

```bash
# Navigate to the extension directory
cd packages/vscode-extension

# Install dependencies
pnpm install

# Build and package the extension
pnpm run build
pnpm run package

# Install the .vsix file
code --install-extension typical-vscode-0.0.1.vsix
```

Or use the convenience script:

```bash
cd packages/vscode-extension
pnpm run dev-install
```

### Requirements

- Your project must have `@elliots/typical` or `@elliots/typical-compiler` as a dependency
- The extension uses the compiler binary from your project's `node_modules`

---

## Debugging

Set `DEBUG=1` for verbose logging:

```bash
DEBUG=1 npm run build
```

## Limitations

### Types that cannot be validated at runtime

These TypeScript features have no runtime representation and are skipped:

| Feature                 | Why                              | Example                                |
| ----------------------- | -------------------------------- | -------------------------------------- |
| Generic type parameters | No runtime type info for `T`     | `function process<T>(x: T): T`         |
| Conditional types       | Compile-time only                | `T extends string ? A : B`             |
| `infer` keyword         | Compile-time type inference      | `T extends Array<infer U> ? U : never` |
| `keyof` operator        | Compile-time key extraction      | `keyof User`                           |
| Indexed access types    | Compile-time type lookup         | `User['name']`                         |
| Unique symbols          | Symbol identity not checkable    | `declare const id: unique symbol`      |
| Index signature values  | Would require iterating all keys | `{ [key: string]: number }`            |

### Other limitations

- **Type-only imports** - `import type { MyClass }` can't use instanceof (class doesn't exist at runtime)
- **Function signatures** - Only validates `typeof === 'function'`, not parameter/return types
- **Function overloads** - Validates the implementation signature, not individual overload signatures
- **Complex library types** - DOM types, React types, etc. may exceed complexity limits (configurable via `maxGeneratedFunctions`)

### What IS validated

Despite these limitations, Typical validates most practical TypeScript patterns:

- All primitive types (string, number, boolean, bigint, symbol, null, undefined)
- Object properties and nested objects
- Arrays and tuples (including variadic tuples)
- Union and intersection types
- Literal types and template literal types
- Enums (string and numeric)
- Utility types (Partial, Required, Pick, Omit, Record, Extract, Exclude)
- Mapped and conditional types (when resolved to concrete types)
- Branded/opaque types (validates the underlying primitive)
- Class instances (via instanceof)
- Built-in types (Date, Map, Set, URL, Error, etc.)

---

## Benchmarks

Runtime validation performance comparing Typical vs Zod vs no validation:

| Scenario                           |   Nothing |   Typical |       Zod | vs Nothing |   vs Zod |
| ---------------------------------- | --------: | --------: | --------: | ---------: | -------: |
| string                             |  23.91M/s |  24.86M/s |  24.80M/s |    🟡 1.0x |  🟡 1.0x |
| number                             |  24.33M/s |  25.44M/s |  24.44M/s |    🟡 1.0x |  🟡 1.0x |
| boolean                            |  24.49M/s |  24.49M/s |  24.19M/s |    🟡 1.0x |  🟡 1.0x |
| object w/ template literals        |  24.53M/s |  21.39M/s |   7.71M/s |    🟡 0.9x |  🟢 2.8x |
| nested w/ template literals        |  24.69M/s |   8.05M/s |   2.31M/s |    🔴 0.3x |  🟢 3.5x |
| array w/ templates (10)            |  29.89M/s |   7.10M/s |   1.54M/s |    🔴 0.2x |  🟢 4.6x |
| array w/ templates (100)           |  30.18M/s | 795.31K/s | 150.09K/s |    🔴 0.0x |  🟢 5.3x |
| union types                        |  29.77M/s |  30.69M/s |  10.76M/s |    🟡 1.0x |  🟢 2.9x |
| template literals                  |  30.09M/s |  17.23M/s |   1.71M/s |    🔴 0.6x | 🟢 10.1x |
| complex config                     |  30.56M/s |  29.14M/s |   3.51M/s |    🟡 1.0x |  🟢 8.3x |
| JSON.parse (small)                 |   4.61M/s |   4.37M/s |   3.85M/s |    🟡 0.9x |  🟢 1.1x |
| JSON.parse (small+filtered extras) |   4.65M/s |   4.32M/s |   3.79M/s |    🟡 0.9x |  🟢 1.1x |
| JSON.parse (medium)                |   2.85M/s |   2.26M/s | 928.42K/s |    🔴 0.8x |  🟢 2.4x |
| JSON.parse (large)                 | 209.41K/s | 186.91K/s |  99.28K/s |    🟡 0.9x |  🟢 1.9x |
| JSON.parse (1000 large)            |     211/s |     212/s |     104/s |    🟡 1.0x |  🟢 2.0x |
| JSON.stringify (small)             |   9.99M/s |   9.30M/s |   6.70M/s |    🟡 0.9x |  🟢 1.4x |
| JSON.stringify (small+extras)      |   2.85M/s |   9.20M/s |   6.98M/s |    🟢 3.2x |  🟢 1.3x |
| JSON.stringify (medium)            |   5.09M/s |   3.82M/s |   1.16M/s |    🔴 0.8x |  🟢 3.3x |
| JSON.stringify (large)             | 392.53K/s | 330.45K/s | 132.50K/s |    🔴 0.8x |  🟢 2.5x |
| JSON.stringify (1000 large)        |     362/s |     339/s |     128/s |    🟡 0.9x |  🟢 2.7x |

- **vs Nothing**: Speed relative to no validation or filtering (1.0x = same speed)
- **vs Zod**: Speed relative to Zod (1.0x = same speed)

---

## Changelog

<!-- CHANGELOG_START -->

### v0.3.0 (2026-01-14)

- Build call graph across whole project to avoid validating already-validated data
- Source map vis in the playround
- Add 'never' support, the property must not exist
- Fix: Node 24

<!-- CHANGELOG_END -->
