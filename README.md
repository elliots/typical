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

| Option              | Default                                                   | Description                                   |
| ------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `include`           | `["**/*.ts", "**/*.tsx"]`                                 | Files to transform                            |
| `exclude`           | `["node_modules/**", "**/*.d.ts", "dist/**", "build/**"]` | Files to skip                                 |
| `validateFunctions` | `true`                                                    | Validate function parameters and return types |
| `validateCasts`     | `false`                                                   | Validate type assertions (`as Type`)          |

---

## How It Works

Typical uses a Go-based compiler that leverages the TypeScript type checker to analyze your code. It generates runtime validators that check values against their declared types.

Types that can't be validated at runtime (like generic type parameters `T`) are skipped. You can still use `any` and `unknown` to opt out of validation.

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
