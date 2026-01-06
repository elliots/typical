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
| `reusableValidators`     | `true`                                                    | Hoist validators to module scope for reduced code size            |

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
- **Type-aware dirty tracking** - Tracks when validated values might become invalid. Primitives stay valid after being passed to functions (they're copied), but objects are re-validated if passed to unknown functions. Pure functions (listed in the config) like `console.log` don't invalidate objects.
- **Union early bail-out** - Union type checks use if-else chains so the first matching type succeeds immediately
- **Skip comments** - Add `// @typical-ignore` before a function to skip all validation for it

## Debugging

Set `DEBUG=1` for verbose logging:

```bash
DEBUG=1 npm run build
```

## Limitations

- Generic type parameters (`T`) cannot be validated - no runtime type information
- Type-only imports of classes aren't checked (can't do instanceof on type-only imports)
- Validation of functions is just not done. Need to think about that one.
- Some complex types may not be fully supported yet. If you find any that fail, please open an issue!
