# Typical

Typical adds runtime validation to typescript, making TypeScript type-safe at runtime *with no changes to your code*. 

It can be used as a TSC plugin, or ESM loader for Node.js.

(Could add unplugin/vite plugin, bun plugin etc. if needed.)

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
- ✅ ESM loader for runtime transformation with `node --import typical/esm` (or `node --loader typical/esm-loader` for older Node versions)
- ✅ tsx wrapper (ttsx) for easy use like `npx ttsx script.ts`

## Installation

```bash
npm add typical
```

## Configuration

Optional: Create a `typical.json` file in your project root.

If not provided, these default settings will be used.

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules/**", "**/*.d.ts", "dist/**"],
  "optimizeReused": true
}
```

## Usage

See ./samples/esm and ./samples/tsc and ./samples/ttsx

Quickest way to try it out is to use ttsx:

```bash
npm add github:elliots/typical
npx ttsx your-script.ts
```

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
